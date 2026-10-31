import { NextRequest, NextResponse, after } from 'next/server';
import { Priority } from '@prisma/client';
import { prisma, withDbRetry } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { assertTaskAccess, sanitizeCommentsForUser } from '@/lib/security/query-guard';
import { ForbiddenError } from '@/lib/security/rbac';
import { broadcastToSpaceStaff } from '@/lib/sse-broker';
import { fanOutCollaborationNotification } from '@/lib/collaboration';
import { getOrSetCache, invalidateCachePrefix, peekCache } from '@/lib/server-cache';
import { updateTaskInMasterStore, removeTaskFromMasterStore } from '@/lib/task-store';

function runAfterResponse(fn: () => Promise<void>) {
  try {
    after(async () => {
      try {
        await fn();
      } catch (err) {
        console.warn('[PATCH /api/tasks/[id]] Background side-effect error:', err);
      }
    });
  } catch {
    void fn().catch((err) => {
      console.warn('[PATCH /api/tasks/[id]] Fallback background error:', err);
    });
  }
}

async function getAuthenticatedUser(request: NextRequest) {
  let token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authHeader = request.headers.get('authorization');
  if (!token && authHeader?.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  if (!token) {
    return { error: 'Unauthorized: Authentication required.', status: 401 };
  }

  const sessionData = await validateSession(token);
  if (!sessionData) {
    return { error: 'Unauthorized: Session is expired or invalid.', status: 401 };
  }

  return { user: sessionData.user };
}

// GET /api/tasks/[id] - Retrieve full task details, comments, and attachments with clearance guard
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await context.params;
    const ipAddress = request.headers.get('x-forwarded-for') || '127.0.0.1';
    const forceFresh =
      request.nextUrl.searchParams.get('fresh') === '1' ||
      Boolean(request.nextUrl.searchParams.get('_t'));

    const cacheKey = `task:detail:${taskId}`;

    // Run session authentication and single-round-trip relationJoins task query in parallel (< 40ms cold, < 5ms warm)
    const [auth, rawTask] = await Promise.all([
      getAuthenticatedUser(request),
      getOrSetCache(
        cacheKey,
        30_000, // 30s fresh TTL
        async () => {
          const task = await prisma.task.findUnique({
            where: { id: taskId },
            relationLoadStrategy: 'join',
            include: {
              originSpace: {
                select: {
                  id: true,
                  name: true,
                  key: true,
                  departmentHeadId: true,
                  members: { select: { userId: true } },
                },
              },
              space: {
                include: {
                  statuses: { orderBy: { order: 'asc' } },
                  lists: { orderBy: { order: 'asc' } },
                  customFields: {
                    include: {
                      list: { select: { id: true, name: true } },
                    },
                    orderBy: { order: 'asc' },
                  },
                  ticketTemplates: true,
                  slaPolicy: {
                    select: {
                      urgentHours: true,
                      highHours: true,
                      normalHours: true,
                      lowHours: true,
                    },
                  },
                  members: {
                    select: { userId: true, role: true },
                  },
                },
              },
              list: true,
              status: true,
              customFieldValues: {
                include: {
                  field: true,
                },
              },
              checklistItems: {
                orderBy: { order: 'asc' },
              },
              attachments: {
                include: {
                  uploadedBy: {
                    select: { id: true, name: true, username: true },
                  },
                },
                orderBy: { createdAt: 'desc' },
              },
              createdBy: {
                select: {
                  id: true,
                  username: true,
                  name: true,
                  email: true,
                  globalRole: true,
                  spaceMemberships: {
                    include: {
                      space: { select: { id: true, name: true, key: true } },
                    },
                  },
                },
              },
              assignee: {
                select: { id: true, username: true, name: true, email: true, globalRole: true },
              },
              comments: {
                include: {
                  author: {
                    select: { id: true, username: true, name: true, email: true, globalRole: true },
                  },
                },
                orderBy: { createdAt: 'asc' },
              },
              contributors: {
                select: {
                  id: true,
                  username: true,
                  name: true,
                  email: true,
                  globalRole: true,
                  spaceMemberships: {
                    include: {
                      space: { select: { id: true, name: true, key: true } },
                    },
                  },
                },
              },
              history: {
                include: {
                  actor: {
                    select: {
                      id: true,
                      username: true,
                      name: true,
                      email: true,
                      globalRole: true,
                      spaceMemberships: {
                        include: {
                          space: { select: { id: true, name: true, key: true } },
                        },
                      },
                    },
                  },
                  fromSpace: { select: { id: true, name: true, key: true } },
                  toSpace: { select: { id: true, name: true, key: true } },
                },
                orderBy: { createdAt: 'desc' },
              },
            },
          });

          if (!task) return null;

          const homeDept =
            (task.createdBy as any)?.spaceMemberships?.[0]?.space?.name ||
            (task.createdBy?.globalRole === 'EMPLOYEE' ? 'Employee' : 'General');

          return {
            ...task,
            createdBy: {
              ...task.createdBy,
              homeDepartment: homeDept,
            },
          };
        },
        { swrMs: 120_000, forceFresh }
      ),
    ]);

    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!rawTask) {
      return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
    }

    const { user } = auth;

    // Validate RBAC clearance directly in memory against the already-fetched task object (0 DB round-trips)
    const isSuperadmin = user.globalRole === 'SUPERADMIN';
    const isSpaceStaff =
      isSuperadmin ||
      rawTask.space?.departmentHeadId === user.id ||
      Boolean(rawTask.space?.members?.some((m: any) => m.userId === user.id));
    const isOriginSpaceStaff = Boolean(
      rawTask.originSpace &&
        (rawTask.originSpace.departmentHeadId === user.id ||
          rawTask.originSpace.members?.some((m: any) => m.userId === user.id))
    );
    const isCreator = rawTask.createdById === user.id;
    const isAssignee = rawTask.assigneeId === user.id;
    const isContributor = Boolean(
      Array.isArray(rawTask.contributors) &&
        rawTask.contributors.some((c: any) => c.id === user.id)
    );

    if (
      !isSuperadmin &&
      !isCreator &&
      !isAssignee &&
      !isContributor &&
      !isSpaceStaff &&
      !isOriginSpaceStaff
    ) {
      runAfterResponse(async () => {
        await prisma.auditLog.create({
          data: {
            event: 'UNAUTHORIZED_CROSS_DEPARTMENT_ACCESS_ATTEMPT',
            userId: user.id,
            resourceType: 'Task',
            resourceId: rawTask.id,
            ipAddress,
            details: JSON.stringify({
              message: `User ${user.username} (${user.globalRole}) attempted to access task ${rawTask.taskKey} in unassigned space ${rawTask.space?.name}`,
              attemptedSpaceId: rawTask.spaceId,
              attemptedSpaceKey: rawTask.space?.key,
              userRole: user.globalRole,
            }),
          },
        });
      });

      return NextResponse.json(
        {
          error: `HTTP 403 Forbidden: Clearance denied. User '${user.username}' is not a member of Space '${rawTask.space?.name}'.`,
        },
        { status: 403 }
      );
    }

    // Strip internal comments in memory for non-staff viewers
    const visibleComments = sanitizeCommentsForUser(rawTask.comments || [], user, isSpaceStaff);

    return NextResponse.json({
      task: {
        ...rawTask,
        comments: visibleComments,
      },
    });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    console.error('Failed to get task:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error fetching task' },
      { status: error instanceof Error && error.message.includes('not found') ? 404 : 500 }
    );
  }
}

// PATCH /api/tasks/[id] - Inline update of status, assignee, priority, content, or custom fields
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const [auth, { id: taskId }, body] = await Promise.all([
      getAuthenticatedUser(request),
      context.params,
      request.json(),
    ]);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user } = auth;
    const ipAddress = request.headers.get('x-forwarded-for') || '127.0.0.1';

    // Layer 2 Assertion: Enforce clearance. Throws 403 Forbidden & records AuditLog if unauthorized.
    // Note: assertTaskAccess already guarantees user is Superadmin, Creator, Assignee, Contributor, Space Staff, or Origin Space Staff!
    const currentTask = await assertTaskAccess(taskId, user, { ipAddress, db: prisma });
    const existingTask = currentTask;

    const {
      spaceId: newSpaceId,
      statusId,
      assigneeId,
      priority,
      title,
      description,
      customFields,
      customFieldValues,
      listId,
      startDate,
      dueDate,
      isMilestone,
      dependsOnIds,
      progress,
    } = body;

    const isSuperadmin = user.globalRole === 'SUPERADMIN';
    const isCreator = currentTask.createdById === user.id;
    const isAssignee = currentTask.assigneeId === user.id;

    // Only run extra membership check if a non-creator/non-assignee contributor attempts to transfer space or queue
    if (!isSuperadmin && !isCreator && !isAssignee && (newSpaceId !== undefined || listId !== undefined)) {
      const [membership, spaceRecord, originMembership, originSpaceRecord] = await Promise.all([
        prisma.spaceMember.findUnique({
          where: { spaceId_userId: { spaceId: currentTask.spaceId, userId: user.id } },
          select: { spaceId: true },
        }),
        prisma.space.findFirst({
          where: { id: currentTask.spaceId, departmentHeadId: user.id },
          select: { id: true },
        }),
        currentTask.originSpaceId
          ? prisma.spaceMember.findUnique({
              where: { spaceId_userId: { spaceId: currentTask.originSpaceId, userId: user.id } },
              select: { spaceId: true },
            })
          : Promise.resolve(null),
        currentTask.originSpaceId
          ? prisma.space.findFirst({
              where: { id: currentTask.originSpaceId, departmentHeadId: user.id },
              select: { id: true },
            })
          : Promise.resolve(null),
      ]);

      const isSpaceOrOriginStaff = Boolean(membership || spaceRecord || originMembership || originSpaceRecord);
      if (!isSpaceOrOriginStaff) {
        return NextResponse.json(
          { error: 'Forbidden: Only department staff, creator, or assignee can transfer ticket space or queue list.' },
          { status: 403 }
        );
      }
    }

    // Circular Dependency Validation: A task cannot depend on itself
    if (dependsOnIds !== undefined) {
      let candidateIds: string[] = [];
      if (Array.isArray(dependsOnIds)) {
        candidateIds = dependsOnIds.map(String).map((s) => s.trim()).filter(Boolean);
      } else if (typeof dependsOnIds === 'string' && dependsOnIds.trim()) {
        try {
          const parsed = JSON.parse(dependsOnIds);
          if (Array.isArray(parsed)) {
            candidateIds = parsed.map(String).map((s) => s.trim()).filter(Boolean);
          }
        } catch {
          candidateIds = [dependsOnIds.trim()];
        }
      }

      if (candidateIds.includes(taskId)) {
        return NextResponse.json(
          { error: 'CIRCULAR_DEPENDENCY', message: 'A task cannot depend on itself.' },
          { status: 400 }
        );
      }
    }

    const updateData: Record<string, any> = {};

    let spaceUpdated = false;
    let targetSpace: any = null;
    if (newSpaceId && newSpaceId !== currentTask.spaceId) {
      targetSpace = await prisma.space.findUnique({
        where: { id: newSpaceId },
        include: {
          statuses: { orderBy: { order: 'asc' } },
          lists: { orderBy: { order: 'asc' } },
        },
      });
      if (!targetSpace) {
        return NextResponse.json({ error: 'Target department space not found.' }, { status: 404 });
      }
      updateData.spaceId = targetSpace.id;
      updateData.originSpaceId = existingTask?.originSpaceId || currentTask.spaceId;
      spaceUpdated = true;
    }

    const effectiveSpaceId = targetSpace ? targetSpace.id : currentTask.spaceId;

    let statusUpdated = false;
    let resolvedStatus: any = null;
    if (statusId || spaceUpdated) {
      const preloadedStatuses = (currentTask.space as any)?.statuses;
      const spaceStatuses = targetSpace
        ? targetSpace.statuses
        : Array.isArray(preloadedStatuses) && preloadedStatuses.length > 0
        ? preloadedStatuses
        : await getOrSetCache(
            `space:${effectiveSpaceId}:statuses`,
            60_000,
            () =>
              prisma.taskStatus.findMany({
                where: { spaceId: effectiveSpaceId },
                orderBy: { order: 'asc' },
              })
          );

      // 1. Direct match by ID in target space
      let status = spaceStatuses.find((s: any) => s.id === statusId) || null;

      // 2. If statusId is a UUID from a foreign space, lookup foreign status to derive semantic intent
      let foreignStatus: any = null;
      if (!status && statusId && typeof statusId === 'string' && statusId.length > 10 && !statusId.startsWith('st-')) {
        foreignStatus = await prisma.taskStatus.findUnique({ where: { id: statusId } }).catch(() => null);
      }

      // 3. Resolve semantic intent across all 5 canonical states
      if (!status) {
        const rawIntent = (
          foreignStatus ? foreignStatus.name : (statusId || '')
        ).toLowerCase().trim();

        const isOpen = rawIntent === 'st-open' || /open|todo|triage|new|backlog/i.test(rawIntent);
        const isProg = rawIntent === 'st-prog' || /prog|doing|active|wip|in_progress|in progress/i.test(rawIntent);
        const isPend = rawIntent === 'st-pend' || /pend|wait|hold|review|approv|block/i.test(rawIntent);
        const isReso = rawIntent === 'st-reso' || (foreignStatus?.isCompleted && !foreignStatus?.isClosed) || /resolv|done|solv|fix/i.test(rawIntent);
        const isClos = rawIntent === 'st-clos' || foreignStatus?.isClosed || /clos|complet|cancel|finish/i.test(rawIntent);

        if (isOpen) {
          status = spaceStatuses.find((s: any) => !s.isCompleted && !s.isClosed && /open|todo|triage|new/i.test(s.name)) ||
                   spaceStatuses.find((s: any) => !s.isCompleted && !s.isClosed) ||
                   spaceStatuses[0] || null;
        } else if (isProg) {
          status = spaceStatuses.find((s: any) => /prog|active|doing|wip/i.test(s.name)) ||
                   spaceStatuses[1] || spaceStatuses[0] || null;
        } else if (isPend) {
          status = spaceStatuses.find((s: any) => /pend|wait|review|block|hold/i.test(s.name)) || null;
          // Auto-provision standard Pending status for this space if missing
          if (!status) {
            status = await prisma.taskStatus.create({
              data: {
                spaceId: effectiveSpaceId,
                name: 'Pending',
                color: '#F59E0B',
                order: 2,
                isCompleted: false,
                isClosed: false,
              },
            }).catch(() => null);
          }
          if (!status) {
            status = spaceStatuses.find((s: any) => /pend|wait|review/i.test(s.name)) || spaceStatuses[1] || spaceStatuses[0];
          }
        } else if (isReso) {
          status = spaceStatuses.find((s: any) => s.isCompleted && !s.isClosed) ||
                   spaceStatuses.find((s: any) => /resolv|done|solv|fix/i.test(s.name)) || null;
          // Auto-provision standard Resolved status for this space if missing
          if (!status) {
            status = await prisma.taskStatus.create({
              data: {
                spaceId: effectiveSpaceId,
                name: 'Resolved',
                color: '#10B981',
                order: spaceStatuses.length,
                isCompleted: true,
                isClosed: false,
              },
            }).catch(() => null);
          }
          if (!status) {
            status = spaceStatuses.find((s: any) => s.isCompleted) || spaceStatuses[spaceStatuses.length - 1];
          }
        } else if (isClos) {
          status = spaceStatuses.find((s: any) => s.isClosed) ||
                   spaceStatuses.find((s: any) => /clos|cancel|arch/i.test(s.name)) || null;
          // Auto-provision standard Closed status for this space if missing
          if (!status) {
            status = await prisma.taskStatus.create({
              data: {
                spaceId: effectiveSpaceId,
                name: 'Closed',
                color: '#6B7280',
                order: spaceStatuses.length + 1,
                isCompleted: true,
                isClosed: true,
              },
            }).catch(() => null);
          }
          if (!status) {
            status = spaceStatuses.find((s: any) => s.isClosed || s.isCompleted) || spaceStatuses[spaceStatuses.length - 1];
          }
        } else {
          // Exact name match fallback
          status = spaceStatuses.find((s: any) => s.name.toLowerCase() === rawIntent) ||
                   spaceStatuses.find((s: any) => s.id === statusId) || null;
        }

        // Space fallback
        if (!status) {
          status = spaceStatuses[0] || null;
        }
      }

      if (!status) {
        return NextResponse.json({ error: 'Status not found.' }, { status: 404 });
      }
      resolvedStatus = status;
      updateData.statusId = status.id;
      if (existingTask && existingTask.statusId !== status.id) {
        statusUpdated = true;
      }
    }

    let assigneeUpdated = false;
    if (assigneeId !== undefined) {
      const targetAssigneeId = assigneeId === null || assigneeId === '' ? null : assigneeId;
      if (targetAssigneeId === null) {
        updateData.assigneeId = null;
      } else {
        const assignee = await prisma.user.findUnique({
          where: { id: targetAssigneeId },
        });
        if (!assignee) {
          return NextResponse.json({ error: 'Assignee user not found.' }, { status: 404 });
        }
        updateData.assigneeId = targetAssigneeId;
      }

      if (existingTask && existingTask.assigneeId !== targetAssigneeId) {
        assigneeUpdated = true;
      }
    }

    if (priority && ['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(priority.toUpperCase())) {
      updateData.priority = priority.toUpperCase() as Priority;
    }

    if (title !== undefined) {
      updateData.title = String(title).trim();
    }

    if (description !== undefined) {
      updateData.description = description ? String(description).trim() : null;
    }

    if (customFields !== undefined) {
      updateData.customFields =
        typeof customFields === 'string'
          ? customFields
          : JSON.stringify(customFields);
    }

    if (listId) {
      const targetList = await prisma.list.findUnique({
        where: { id: listId },
      });
      if (targetList && targetList.spaceId === effectiveSpaceId) {
        if (targetList.isPrivate) {
          const isSuperadmin = user.globalRole === 'SUPERADMIN';
          const targetSpaceRecord = await prisma.space.findUnique({
            where: { id: effectiveSpaceId },
            select: { departmentHeadId: true },
          });
          const isHead = targetSpaceRecord?.departmentHeadId === user.id;
          let isMember = isSuperadmin || isHead;
          if (!isMember) {
            const membership = await prisma.spaceMember.findUnique({
              where: {
                spaceId_userId: {
                  spaceId: effectiveSpaceId,
                  userId: user.id,
                },
              },
            });
            isMember = Boolean(membership);
          }

          if (!isMember) {
            return NextResponse.json(
              {
                error: 'PRIVATE_QUEUE_RESTRICTED',
                message: 'Only department members or Superadmins can assign tickets to a private queue.',
              },
              { status: 403 }
            );
          }
        }
        updateData.listId = targetList.id;
      }
    } else if (spaceUpdated && targetSpace) {
      // Default to first non-private queue in target space if listId was not specified
      const defaultList = targetSpace.lists.find((l: any) => !l.isPrivate) || targetSpace.lists[0];
      if (defaultList) {
        updateData.listId = defaultList.id;
      }
    }

    let scheduleUpdated = false;
    if (startDate !== undefined) {
      updateData.startDate = startDate ? new Date(startDate) : null;
      if (String(existingTask?.startDate || '') !== String(updateData.startDate || '')) {
        scheduleUpdated = true;
      }
    }

    if (dueDate !== undefined) {
      updateData.dueDate = dueDate ? new Date(dueDate) : null;
      if (String(existingTask?.dueDate || '') !== String(updateData.dueDate || '')) {
        scheduleUpdated = true;
      }
    }

    let milestoneUpdated = false;
    if (isMilestone !== undefined) {
      updateData.isMilestone = Boolean(isMilestone);
      if (existingTask?.isMilestone !== updateData.isMilestone) {
        milestoneUpdated = true;
      }
    }

    let dependencyUpdated = false;
    if (dependsOnIds !== undefined) {
      let candidateIds: string[] = [];
      if (Array.isArray(dependsOnIds)) {
        candidateIds = dependsOnIds.map(String).map((s) => s.trim()).filter(Boolean);
      } else if (typeof dependsOnIds === 'string' && dependsOnIds.trim()) {
        try {
          const parsed = JSON.parse(dependsOnIds);
          if (Array.isArray(parsed)) {
            candidateIds = parsed.map(String).map((s) => s.trim()).filter(Boolean);
          }
        } catch {
          candidateIds = [dependsOnIds.trim()];
        }
      }
      if (candidateIds.includes(taskId)) {
        return NextResponse.json(
          { error: 'CIRCULAR_DEPENDENCY', message: 'A task cannot depend on itself.' },
          { status: 400 }
        );
      }
      const serialized = candidateIds.length > 0 ? JSON.stringify(candidateIds) : null;
      updateData.dependsOnIds = serialized;
      if (existingTask?.dependsOnIds !== serialized) {
        dependencyUpdated = true;
      }
    }

    if (progress !== undefined) {
      updateData.progress = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
    }

    // Always track user as contributor on mutation
    updateData.contributors = {
      connect: { id: user.id },
    };



    const fieldsToSync: Record<string, any> | null =
      customFieldValues && typeof customFieldValues === 'object'
        ? customFieldValues
        : customFields
        ? typeof customFields === 'object'
          ? customFields
          : typeof customFields === 'string'
          ? (() => {
              try {
                return JSON.parse(customFields);
              } catch {
                return null;
              }
            })()
          : null
        : null;

    const hasCustomFieldsToSync = Boolean(
      fieldsToSync && typeof fieldsToSync === 'object' && Object.keys(fieldsToSync).length > 0
    );

    const leanUpdateSelect = {
      id: true,
      taskKey: true,
      title: true,
      description: true,
      priority: true,
      statusId: true,
      listId: true,
      spaceId: true,
      originSpaceId: true,
      assigneeId: true,
      createdById: true,
      customFields: true,
      startDate: true,
      dueDate: true,
      isMilestone: true,
      dependsOnIds: true,
      progress: true,
      createdAt: true,
      updatedAt: true,
      status: {
        select: {
          id: true,
          name: true,
          color: true,
          order: true,
          isCompleted: true,
          isClosed: true,
        },
      },
      list: {
        select: { id: true, name: true },
      },
      space: {
        select: { id: true, name: true, key: true },
      },
      originSpace: {
        select: { id: true, name: true, key: true },
      },
      assignee: {
        select: { id: true, name: true, username: true, email: true },
      },
    };

    const cachedMaster = peekCache<any[]>('tasks:master:all');
    const existingCached = cachedMaster?.find((t: any) => t.id === taskId);

    if (!hasCustomFieldsToSync && !spaceUpdated) {
      // FAST PATH: Instant In-Memory Cache Mutation & Asynchronous Database Persistence
      // Allows status changes, priority tweaks, and inline edits to respond in < 15ms
      const formattedTask = {
        ...currentTask,
        ...existingCached,
        ...updateData,
        id: taskId,
        taskKey: currentTask.taskKey,
        statusId: updateData.statusId || currentTask.statusId,
        status: resolvedStatus || existingCached?.status || (currentTask as any).status,
        space: {
          ...(existingCached?.space || currentTask.space),
          statuses:
            (existingCached?.space as any)?.statuses ||
            (currentTask.space as any)?.statuses ||
            (targetSpace?.statuses || []),
        },
        list: {
          ...(existingCached?.list || currentTask.list),
        },
        assignee: updateData.assigneeId !== undefined
          ? (updateData.assigneeId ? (existingCached?.assignee || currentTask.assignee) : null)
          : (existingCached?.assignee || currentTask.assignee),
        createdBy: existingCached?.createdBy || (currentTask as any).createdBy || {
          id: user.id,
          name: user.name || user.username,
          username: user.username,
          email: user.email,
          homeDepartment: 'General',
        },
        _count: existingCached?._count || { comments: 0, attachments: 0 },
        attachments: existingCached?.attachments || [],
        checklistItems: existingCached?.checklistItems || [],
        customFieldValues: existingCached?.customFieldValues || [],
        contributors: Array.isArray(existingCached?.contributors)
          ? (existingCached.contributors.some((c: any) => c.id === user.id)
              ? existingCached.contributors
              : [...existingCached.contributors, { id: user.id, name: user.name || user.username }])
          : [{ id: user.id, name: user.name || user.username }],
        updatedAt: new Date().toISOString(),
        createdAt: currentTask.createdAt || existingCached?.createdAt || new Date().toISOString(),
      };

      // Real-Time LAN Pipeline: Broadcast TASK_UPDATED event to space staff, creator, and assignee
      const taskUpdatedEvent = {
        type: 'TASK_UPDATED',
        spaceId: formattedTask.spaceId,
        listId: formattedTask.listId,
        task: formattedTask,
        previousStatusId: existingTask?.statusId,
        previousAssigneeId: existingTask?.assigneeId,
        timestamp: new Date().toISOString(),
      };

      // Build nested history entries to fold directly into the single atomic prisma.task.update write
      const historyEntries: any[] = [];
      if (statusUpdated && formattedTask.status) {
        const isClosed = formattedTask.status.isClosed || formattedTask.status.isCompleted;
        historyEntries.push({
          actorId: user.id,
          actionType: isClosed ? 'CLOSED' : 'STATUS_CHANGE',
          fromSpaceId: formattedTask.spaceId,
          toSpaceId: formattedTask.spaceId,
          fromQueueName: formattedTask.list?.name || null,
          toQueueName: formattedTask.list?.name || null,
          notes: `Status changed to ${formattedTask.status.name}`,
        });
      }

      if (scheduleUpdated) {
        historyEntries.push({
          actorId: user.id,
          actionType: 'SCHEDULE_UPDATE',
          fromSpaceId: currentTask.spaceId,
          toSpaceId: currentTask.spaceId,
          fromQueueName: formattedTask.list?.name || null,
          toQueueName: formattedTask.list?.name || null,
          notes: `Schedule updated: Start ${formattedTask.startDate ? new Date(formattedTask.startDate).toISOString().slice(0, 10) : 'None'}, Due ${formattedTask.dueDate ? new Date(formattedTask.dueDate).toISOString().slice(0, 10) : 'None'}`,
        });
      }

      if (milestoneUpdated) {
        historyEntries.push({
          actorId: user.id,
          actionType: 'MILESTONE_TOGGLE',
          fromSpaceId: currentTask.spaceId,
          toSpaceId: currentTask.spaceId,
          fromQueueName: formattedTask.list?.name || null,
          toQueueName: formattedTask.list?.name || null,
          notes: formattedTask.isMilestone ? 'Marked task as Milestone (◆)' : 'Unmarked milestone',
        });
      }

      if (dependencyUpdated) {
        historyEntries.push({
          actorId: user.id,
          actionType: 'DEPENDENCY_UPDATE',
          fromSpaceId: currentTask.spaceId,
          toSpaceId: currentTask.spaceId,
          fromQueueName: formattedTask.list?.name || null,
          toQueueName: formattedTask.list?.name || null,
          notes: `Prerequisite dependencies updated: ${formattedTask.dependsOnIds || 'None'}`,
        });
      }

      if (historyEntries.length > 0) {
        updateData.history = {
          create: historyEntries,
        };
      }

      // Single atomic write: persist task mutation + nested TaskHistory in one DB round-trip
      await withDbRetry(async () => {
        return prisma.task.update({
          where: { id: taskId },
          data: updateData,
          select: { id: true, updatedAt: true },
        });
      });

      // Immediately update in-memory master store & invalidate cross-prefix caches
      updateTaskInMasterStore(formattedTask);
      invalidateCachePrefix(`task:detail:${taskId}`);
      invalidateCachePrefix('spaces:');
      invalidateCachePrefix('notifications:user:');

      // Non-critical side effects (notifications fan-out & SSE broadcast) run after response via Next.js 15 after()
      runAfterResponse(async () => {
        const targetUserIds = [formattedTask.createdById];
        if (formattedTask.assigneeId) targetUserIds.push(formattedTask.assigneeId);
        if (existingTask?.assigneeId) targetUserIds.push(existingTask.assigneeId);

        const notifPromise =
          statusUpdated && formattedTask.status
            ? fanOutCollaborationNotification({
                taskId: formattedTask.id,
                actor: {
                  id: user.id,
                  name: user.name || user.username,
                },
                type: 'STATUS_CHANGE',
                newStatusName: formattedTask.status.name,
                broadcastPayload: taskUpdatedEvent,
              })
            : assigneeUpdated
            ? fanOutCollaborationNotification({
                taskId: formattedTask.id,
                actor: {
                  id: user.id,
                  name: user.name || user.username,
                },
                type: 'ASSIGNEE_CHANGE',
                broadcastPayload: taskUpdatedEvent,
              })
            : fanOutCollaborationNotification({
                taskId: formattedTask.id,
                actor: {
                  id: user.id,
                  name: user.name || user.username,
                },
                type: 'UPDATE',
                broadcastPayload: taskUpdatedEvent,
              });

        await Promise.allSettled([
          notifPromise,
          broadcastToSpaceStaff(formattedTask.spaceId, taskUpdatedEvent, targetUserIds),
        ]);
      });

      return NextResponse.json({ success: true, task: formattedTask });
    }

    // Build nested history entries for custom-fields / space-transfer path
    const historyEntries: any[] = [];
    if (spaceUpdated && targetSpace) {
      historyEntries.push({
        actorId: user.id,
        actionType: 'HANDOFF_TRANSFER',
        fromSpaceId: currentTask.spaceId,
        toSpaceId: targetSpace.id,
        fromQueueName: existingTask?.list?.name || 'Unassigned',
        toQueueName: targetSpace.lists?.find((l: any) => l.id === updateData.listId)?.name || 'Queue',
        notes: `Department transferred to ${targetSpace.name}`,
      });
    }

    if (statusUpdated && resolvedStatus) {
      const isClosed = resolvedStatus.isClosed || resolvedStatus.isCompleted;
      historyEntries.push({
        actorId: user.id,
        actionType: isClosed ? 'CLOSED' : 'STATUS_CHANGE',
        fromSpaceId: effectiveSpaceId,
        toSpaceId: effectiveSpaceId,
        fromQueueName: existingTask?.list?.name || null,
        toQueueName: existingTask?.list?.name || null,
        notes: `Status changed to ${resolvedStatus.name}`,
      });
    }

    if (scheduleUpdated) {
      historyEntries.push({
        actorId: user.id,
        actionType: 'SCHEDULE_UPDATE',
        fromSpaceId: currentTask.spaceId,
        toSpaceId: currentTask.spaceId,
        fromQueueName: existingTask?.list?.name || null,
        toQueueName: existingTask?.list?.name || null,
        notes: `Schedule updated: Start ${updateData.startDate ? new Date(updateData.startDate).toISOString().slice(0, 10) : 'None'}, Due ${updateData.dueDate ? new Date(updateData.dueDate).toISOString().slice(0, 10) : 'None'}`,
      });
    }

    if (milestoneUpdated) {
      historyEntries.push({
        actorId: user.id,
        actionType: 'MILESTONE_TOGGLE',
        fromSpaceId: currentTask.spaceId,
        toSpaceId: currentTask.spaceId,
        fromQueueName: existingTask?.list?.name || null,
        toQueueName: existingTask?.list?.name || null,
        notes: updateData.isMilestone ? 'Marked task as Milestone (◆)' : 'Unmarked milestone',
      });
    }

    if (dependencyUpdated) {
      historyEntries.push({
        actorId: user.id,
        actionType: 'DEPENDENCY_UPDATE',
        fromSpaceId: currentTask.spaceId,
        toSpaceId: currentTask.spaceId,
        fromQueueName: existingTask?.list?.name || null,
        toQueueName: existingTask?.list?.name || null,
        notes: `Prerequisite dependencies updated: ${updateData.dependsOnIds || 'None'}`,
      });
    }

    if (historyEntries.length > 0) {
      updateData.history = {
        create: historyEntries,
      };
    }

    const updatedTask = await withDbRetry(async () => {
      if (hasCustomFieldsToSync && fieldsToSync) {
        const definitions = await prisma.customFieldDefinition.findMany({
          where: { spaceId: currentTask.spaceId },
        });
        const defById = new Map(definitions.map((d) => [d.id, d]));
        const defByName = new Map(definitions.map((d) => [d.name.toLowerCase(), d]));

        const upsertPromises: Promise<any>[] = [];
        for (const [key, val] of Object.entries(fieldsToSync)) {
          const fieldDef = defById.get(key) || defByName.get(key.toLowerCase());
          if (fieldDef) {
            upsertPromises.push(
              prisma.taskCustomFieldValue.upsert({
                where: {
                  taskId_fieldId: {
                    taskId,
                    fieldId: fieldDef.id,
                  },
                },
                update: { value: String(val ?? '') },
                create: {
                  taskId,
                  fieldId: fieldDef.id,
                  value: String(val ?? ''),
                },
              })
            );
          }
        }
        if (upsertPromises.length > 0) {
          await Promise.all(upsertPromises);
        }
      }

      // Direct single-statement update including nested TaskHistory creation
      return prisma.task.update({
        where: { id: taskId },
        data: updateData,
        select: leanUpdateSelect,
      });
    });

    const formattedTask = {
      ...currentTask,
      ...existingCached,
      ...updatedTask,
      status: updatedTask.status || existingCached?.status || (currentTask as any).status,
      space: {
        ...(existingCached?.space || currentTask.space),
        ...(updatedTask.space || {}),
      },
      list: {
        ...(existingCached?.list || currentTask.list),
        ...(updatedTask.list || {}),
      },
      assignee: updatedTask.assignee !== undefined ? updatedTask.assignee : existingCached?.assignee,
      createdBy: existingCached?.createdBy || (currentTask as any).createdBy || {
        id: user.id,
        name: user.name || user.username,
        username: user.username,
        email: user.email,
        homeDepartment: 'General',
      },
      _count: existingCached?._count || { comments: 0, attachments: 0 },
      attachments: existingCached?.attachments || [],
      checklistItems: existingCached?.checklistItems || [],
      customFieldValues: existingCached?.customFieldValues || [],
    };

    // Real-Time LAN Pipeline: Broadcast TASK_UPDATED event to space staff, creator, and assignee
    const taskUpdatedEvent = {
      type: 'TASK_UPDATED',
      spaceId: updatedTask.spaceId,
      listId: updatedTask.listId,
      task: formattedTask,
      previousStatusId: existingTask?.statusId,
      previousAssigneeId: existingTask?.assigneeId,
      timestamp: new Date().toISOString(),
    };

    // Immediately update in-memory master store & invalidate cross-prefix caches
    updateTaskInMasterStore(formattedTask);
    invalidateCachePrefix(`task:detail:${taskId}`);
    invalidateCachePrefix('spaces:');
    invalidateCachePrefix('notifications:user:');

    // Fan-Out Collaboration Notifications & SSE Broadcast in parallel after response
    runAfterResponse(async () => {
      const targetUserIds = [updatedTask.createdById];
      if (updatedTask.assigneeId) targetUserIds.push(updatedTask.assigneeId);
      if (existingTask?.assigneeId) targetUserIds.push(existingTask.assigneeId);

      const notifPromise =
        statusUpdated && updatedTask.status
          ? fanOutCollaborationNotification({
              taskId: updatedTask.id,
              actor: {
                id: user.id,
                name: user.name || user.username,
              },
              type: 'STATUS_CHANGE',
              newStatusName: updatedTask.status.name,
              broadcastPayload: taskUpdatedEvent,
            })
          : assigneeUpdated
          ? fanOutCollaborationNotification({
              taskId: updatedTask.id,
              actor: {
                id: user.id,
                name: user.name || user.username,
              },
              type: 'ASSIGNEE_CHANGE',
              broadcastPayload: taskUpdatedEvent,
            })
          : fanOutCollaborationNotification({
              taskId: updatedTask.id,
              actor: {
                id: user.id,
                name: user.name || user.username,
              },
              type: 'UPDATE',
              broadcastPayload: taskUpdatedEvent,
            });

      await Promise.allSettled([
        notifPromise,
        broadcastToSpaceStaff(updatedTask.spaceId, taskUpdatedEvent, targetUserIds),
      ]);
    });

    return NextResponse.json({ success: true, task: formattedTask });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    console.error('Failed to update task:', error);
    return NextResponse.json(
      { error: 'An unexpected internal error occurred while updating the task.' },
      { status: 500 }
    );
  }
}

// DELETE /api/tasks/[id] - Delete/Archive task with clearance guard and real-time live broadcast
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id: taskId } = await context.params;
    const { user } = auth;
    const ipAddress = request.headers.get('x-forwarded-for') || '127.0.0.1';

    const currentTask = await assertTaskAccess(taskId, user, { ipAddress, db: prisma });

    // Defense-in-depth: Only department staff or Superadmins can permanently delete tickets
    const isMemberOfSpace = Boolean(
      await prisma.spaceMember.findUnique({
        where: {
          spaceId_userId: {
            spaceId: currentTask.spaceId,
            userId: user.id,
          },
        },
      })
    );
    const isDeptHead = Boolean(
      await prisma.space.findFirst({
        where: {
          id: currentTask.spaceId,
          departmentHeadId: user.id,
        },
        select: { id: true },
      })
    );

    const isSpaceStaff =
      user.globalRole === 'SUPERADMIN' || isMemberOfSpace || isDeptHead;

    if (!isSpaceStaff) {
      return NextResponse.json(
        { error: 'Forbidden: Requesters cannot delete tickets. Only department staff or Superadmins have deletion clearance.' },
        { status: 403 }
      );
    }

    await prisma.task.delete({
      where: { id: taskId },
    });

    // Real-Time LAN Pipeline: Broadcast TASK_DELETED
    const taskDeletedEvent = {
      type: 'TASK_DELETED',
      taskId,
      spaceId: currentTask.spaceId,
      timestamp: new Date().toISOString(),
    };

    await broadcastToSpaceStaff(currentTask.spaceId, taskDeletedEvent, [currentTask.createdById]);

    // In-place server cache update
    removeTaskFromMasterStore(taskId);
    invalidateCachePrefix(`task:detail:${taskId}`);
    invalidateCachePrefix('spaces:');
    invalidateCachePrefix('notifications:user:');

    return NextResponse.json({ success: true, deletedTaskId: taskId });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    console.error('Failed to delete task:', error);
    return NextResponse.json(
      { error: 'An unexpected internal error occurred while deleting the task.' },
      { status: 500 }
    );
  }
}

