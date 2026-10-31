import { NextRequest, NextResponse } from 'next/server';
import { Priority, Prisma } from '@prisma/client';
import { prisma, withDbRetry } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { getUserAssignedSpaceIds } from '@/lib/security/rbac';
import { notifySpaceMembers } from '@/lib/notifications';
import { broadcastToSpaceStaff } from '@/lib/sse-broker';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { computeTaskCollaboration } from '@/lib/collaboration';
import { getOrSetCache, peekCache, invalidateCachePrefix } from '@/lib/server-cache';
import { ensureWarmCache } from '@/lib/cache-warmer';

// Pre-warm server caches in background on module initialization
ensureWarmCache();

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

import { fetchMasterTaskList, prependTaskToMasterStore } from '@/lib/task-store';

const spaceKeyCounters = new Map<string, number>();

async function getCollisionProofStartCounter(
  spaceId: string,
  spaceKey: string,
  masterTasks?: any[]
): Promise<{ prefix: string; nextNum: number }> {
  const normalizedKey = spaceKey.toUpperCase();
  const prefix = `${normalizedKey}-`;
  let maxNum = spaceKeyCounters.get(normalizedKey) ?? 100;

  if (masterTasks && Array.isArray(masterTasks)) {
    for (const t of masterTasks) {
      if (typeof t.taskKey === 'string' && t.taskKey.toUpperCase().startsWith(prefix)) {
        const num = parseInt(t.taskKey.slice(prefix.length), 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }
  }

  try {
    const dbTasks = await prisma.task.findMany({
      where: {
        OR: [
          { spaceId },
          { taskKey: { startsWith: prefix } },
        ],
      },
      select: { taskKey: true },
    });

    for (const row of dbTasks) {
      if (typeof row.taskKey === 'string' && row.taskKey.toUpperCase().startsWith(prefix)) {
        const num = parseInt(row.taskKey.slice(prefix.length), 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }
  } catch (err) {
    console.warn('[getCollisionProofStartCounter] DB lookup fallback:', err);
  }

  const nextNum = maxNum + 1;
  spaceKeyCounters.set(normalizedKey, nextNum);
  return { prefix, nextNum };
}

// GET /api/tasks - High-speed in-memory filtered task query engine (<5ms response time)
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user } = auth;
    const { searchParams } = request.nextUrl;
    const spaceId = searchParams.get('spaceId');
    const listId = searchParams.get('listId');
    const fastView = searchParams.get('fastView'); // 'everything', 'all', 'assigned_to_me', 'created_by_me', 'collaborated'
    const search = searchParams.get('search')?.trim();
    const priority = searchParams.get('priority');
    const statusId = searchParams.get('statusId');
    const assigneeId = searchParams.get('assigneeId');
    const dateFrom = searchParams.get('dateFrom')?.trim();
    const dateTo = searchParams.get('dateTo')?.trim();

    const isSuperadmin = user.globalRole === 'SUPERADMIN';
    const forceFresh =
      searchParams.get('fresh') === '1' || Boolean(searchParams.get('_t'));
    const serverStart = performance.now();

    // Parallel in-memory retrieval: master tasks (<0.1ms) + user assigned spaces (<0.1ms)
    const [allTasks, userSpaceIds] = await Promise.all([
      fetchMasterTaskList(forceFresh),
      isSuperadmin ? Promise.resolve([]) : getUserAssignedSpaceIds(user.id),
    ]);

    const userSpaceIdSet = new Set(userSpaceIds);

    // High-performance in-memory filter engine
    let filtered = allTasks.filter((t) => {
      // 1. Layer 1 RBAC Clearance & Fast View filters
      if (fastView === 'collaborated') {
        const collab = computeTaskCollaboration(t as any, userSpaceIds);
        if (!collab.isCollaborated) return false;
        if (!isSuperadmin) {
          const hasClearance = collab.participatingSpaceIds.some((sid) => userSpaceIdSet.has(sid));
          const isCreatorOrContributor =
            t.createdById === user.id ||
            (Array.isArray(t.contributors) && t.contributors.some((c: any) => c.id === user.id));
          if (!hasClearance && !isCreatorOrContributor) return false;
        }
      } else if (fastView === 'created_by_me' || fastView === 'created') {
        if (t.createdById !== user.id) return false;
      } else if (fastView === 'assigned_to_me') {
        if (t.assigneeId !== user.id) return false;
        if (!isSuperadmin) {
          const inAssignedSpace = t.spaceId && userSpaceIdSet.has(t.spaceId);
          const inOriginSpace = t.originSpaceId && userSpaceIdSet.has(t.originSpaceId);
          const isCreator = t.createdById === user.id;
          if (!inAssignedSpace && !inOriginSpace && !isCreator) return false;
        }
      } else {
        // fastView === 'everything', 'all', or queue/space navigation
        if (!isSuperadmin) {
          const inAssignedSpace = t.spaceId && userSpaceIdSet.has(t.spaceId);
          const inOriginSpace = t.originSpaceId && userSpaceIdSet.has(t.originSpaceId);
          const isCreator = t.createdById === user.id;
          const isAssignee = t.assigneeId === user.id;
          const isContributor = Array.isArray(t.contributors) && t.contributors.some((c: any) => c.id === user.id);
          if (!inAssignedSpace && !inOriginSpace && !isCreator && !isAssignee && !isContributor) return false;
        }
      }

      // 2. Private Queue restriction
      if (!isSuperadmin && fastView !== 'collaborated') {
        if (t.list?.isPrivate) {
          if (!t.spaceId || !userSpaceIdSet.has(t.spaceId)) {
            return false;
          }
        }
      }

      // 3. Dynamic interactive filters
      if (spaceId && t.spaceId !== spaceId) {
        return false;
      }

      if (listId && t.listId !== listId) {
        return false;
      }

      if (priority && ['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(priority.toUpperCase())) {
        if (t.priority !== priority.toUpperCase()) return false;
      }

      if (statusId && t.statusId !== statusId) {
        return false;
      }

      if (assigneeId) {
        if (assigneeId === 'unassigned') {
          if (t.assigneeId !== null && t.assigneeId !== undefined) return false;
        } else if (assigneeId === 'me') {
          if (t.assigneeId !== user.id) return false;
        } else {
          if (t.assigneeId !== assigneeId) return false;
        }
      }

      if (search) {
        const q = search.toLowerCase();
        const matchTitle = t.title?.toLowerCase().includes(q);
        const matchKey = t.taskKey?.toLowerCase().includes(q);
        const matchDesc = t.description?.toLowerCase().includes(q);
        if (!matchTitle && !matchKey && !matchDesc) return false;
      }

      if (dateFrom) {
        const fromDate = new Date(`${dateFrom}T00:00:00.000Z`).getTime();
        if (!isNaN(fromDate) && new Date(t.createdAt).getTime() < fromDate) {
          return false;
        }
      }

      if (dateTo) {
        const toDate = new Date(`${dateTo}T23:59:59.999Z`).getTime();
        if (!isNaN(toDate) && new Date(t.createdAt).getTime() > toDate) {
          return false;
        }
      }

      return true;
    });

    // 4. In-Memory Sorting
    if (fastView) {
      filtered.sort((a, b) => {
        const updateDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        if (updateDiff !== 0) return updateDiff;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    } else {
      filtered.sort((a, b) => {
        const orderA = a.status?.order ?? 0;
        const orderB = b.status?.order ?? 0;
        if (orderA !== orderB) return orderA - orderB;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    }

    // 5. Compute real-time user-specific collaboration routing
    const tasks = filtered.map((t) => {
      const collab = computeTaskCollaboration(t as any, userSpaceIds);
      return {
        ...t,
        collaboration: collab,
      };
    });

    const executionMs = (performance.now() - serverStart).toFixed(2);
    const res = NextResponse.json({ tasks });
    res.headers.set('Server-Timing', `task_filter;dur=${executionMs}`);
    res.headers.set('X-Server-Time', `${executionMs}ms`);
    return res;
  } catch (error) {
    console.error('Failed to query tasks:', error);
    return NextResponse.json(
      { error: 'An unexpected internal error occurred while fetching tasks.' },
      { status: 500 }
    );
  }
}

// POST /api/tasks - Create new ticket work item with custom fields
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user } = auth;
    const body = await request.json();
    const {
      title,
      description,
      priority,
      spaceId,
      listId,
      statusId,
      assigneeId,
      customFields,
      customFieldValues,
      checklistItems,
      startDate,
      dueDate,
      isMilestone,
      dependsOnIds,
      progress,
      stagedAttachments,
    } = body;

    // Rate limit: max 30 ticket creations per minute per user
    const intakeLimit = checkRateLimit(`ticket_create:${user.id}`, {
      intervalMs: 60 * 1000,
      maxRequests: 30,
    });
    if (!intakeLimit.success) {
      return NextResponse.json(
        { error: `Ticket creation rate limit reached. Please wait ${intakeLimit.retryAfterSeconds} seconds.` },
        { status: 429, headers: { 'Retry-After': String(intakeLimit.retryAfterSeconds) } }
      );
    }

    if (!title || !spaceId || !listId) {
      return NextResponse.json(
        { error: 'Title, spaceId, and listId are required.' },
        { status: 400 }
      );
    }

    // 1. Resolve Space and List in 0ms from in-memory 'spaces:master' cache
    const masterSpaces = peekCache<any[]>('spaces:master');
    let space = masterSpaces?.find((s) => s.id === spaceId);
    if (!space) {
      space = await prisma.space.findUnique({
        where: { id: spaceId },
        include: {
          departmentHead: { select: { id: true, name: true, username: true, email: true } },
          members: { select: { userId: true, role: true } },
          lists: { orderBy: { order: 'asc' } },
          statuses: { orderBy: { order: 'asc' } },
        },
      });
    }

    if (!space) {
      return NextResponse.json({ error: 'Space not found.' }, { status: 404 });
    }

    let list = space.lists?.find((l: any) => l.id === listId);
    if (!list) {
      list = await prisma.list.findUnique({ where: { id: listId } });
    }

    if (!list) {
      return NextResponse.json({ error: 'List not found.' }, { status: 404 });
    }

    // Integrity Check: Enforce that queue list belongs to the target space
    if (list.spaceId && list.spaceId !== space.id) {
      return NextResponse.json(
        { error: 'INVALID_QUEUE', message: 'The specified queue list does not belong to this department space.' },
        { status: 400 }
      );
    }

    // Validate Private Queue access
    if (list.isPrivate) {
      const isSuperadmin = user.globalRole === 'SUPERADMIN';
      const isHead = space.departmentHeadId === user.id || space.departmentHead?.id === user.id;
      let isMember = isSuperadmin || isHead || Boolean(space.members?.some((m: any) => m.userId === user.id));
      if (!isMember) {
        const membership = await prisma.spaceMember.findUnique({
          where: { spaceId_userId: { spaceId, userId: user.id } },
        });
        isMember = Boolean(membership);
      }

      if (!isMember) {
        return NextResponse.json(
          {
            error: 'PRIVATE_QUEUE_RESTRICTED',
            message: 'Only department members or Superadmins can create tickets in a private queue.',
          },
          { status: 403 }
        );
      }
    }

    // Determine initial status from space statuses
    let finalStatusId = statusId;
    if (finalStatusId) {
      const statusMatch = space.statuses?.find((s: any) => s.id === finalStatusId);
      if (!statusMatch) {
        const initialStatus = space.statuses?.find((s: any) => !s.isCompleted && !s.isClosed) || space.statuses?.[0];
        finalStatusId = initialStatus?.id;
      }
    } else {
      const initialStatus = space.statuses?.find((s: any) => !s.isCompleted && !s.isClosed) || space.statuses?.[0];
      finalStatusId = initialStatus?.id;
    }

    if (!finalStatusId) {
      let dbStatus = await prisma.taskStatus.findFirst({
        where: { spaceId },
        orderBy: { order: 'asc' },
      });
      if (!dbStatus) {
        dbStatus = await prisma.taskStatus.create({
          data: {
            spaceId,
            name: 'Open',
            color: '#3B82F6',
            order: 0,
            isCompleted: false,
            isClosed: false,
          },
        });
      }
      finalStatusId = dbStatus.id;
    }

    const taskPriority =
      priority && ['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(String(priority).toUpperCase())
        ? (String(priority).toUpperCase() as Priority)
        : Priority.NORMAL;

    const customFieldsString =
      typeof customFields === 'string'
        ? customFields
        : JSON.stringify(customFields || {});

    // Parse structured customFieldValues and verify fieldIds exist in this space
    const rawFieldEntries: { fieldId: string; value: string }[] = [];
    if (Array.isArray(customFieldValues)) {
      for (const item of customFieldValues) {
        if (item && item.fieldId && item.value !== undefined && item.value !== null && String(item.value).trim() !== '') {
          rawFieldEntries.push({ fieldId: String(item.fieldId), value: String(item.value).trim() });
        }
      }
    } else if (customFieldValues && typeof customFieldValues === 'object') {
      for (const [fId, val] of Object.entries(customFieldValues)) {
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          rawFieldEntries.push({ fieldId: String(fId), value: String(val).trim() });
        }
      }
    }

    let fieldEntries: { fieldId: string; value: string }[] = [];
    if (rawFieldEntries.length > 0) {
      try {
        const validDefs = await prisma.customFieldDefinition.findMany({
          where: { spaceId: space.id },
          select: { id: true },
        });
        const validIdSet = new Set(validDefs.map((d) => d.id));
        const seenFieldIds = new Set<string>();
        for (const fe of rawFieldEntries) {
          if (validIdSet.has(fe.fieldId) && !seenFieldIds.has(fe.fieldId)) {
            seenFieldIds.add(fe.fieldId);
            fieldEntries.push(fe);
          }
        }
      } catch {
        fieldEntries = [];
      }
    }

    // Parse initial checklist items
    const initialChecklist: string[] = [];
    if (Array.isArray(checklistItems)) {
      for (const item of checklistItems) {
        const itemTitle = typeof item === 'string' ? item.trim() : (item?.title ? String(item.title).trim() : '');
        if (itemTitle) {
          initialChecklist.push(itemTitle);
        }
      }
    }

    // Parse schedule, milestone, dependency and progress fields
    const parsedStartDate = startDate ? new Date(startDate) : null;
    const parsedDueDate = dueDate ? new Date(dueDate) : null;
    const parsedIsMilestone = Boolean(isMilestone);
    let parsedDependsOn: string | null = null;
    if (Array.isArray(dependsOnIds)) {
      const filtered = dependsOnIds.map(String).map((s) => s.trim()).filter(Boolean);
      if (filtered.length > 0) parsedDependsOn = JSON.stringify(filtered);
    } else if (typeof dependsOnIds === 'string' && dependsOnIds.trim()) {
      try {
        const parsed = JSON.parse(dependsOnIds);
        if (Array.isArray(parsed) && parsed.length > 0) {
          parsedDependsOn = JSON.stringify(parsed.map(String).map((s) => s.trim()).filter(Boolean));
        }
      } catch {
        parsedDependsOn = JSON.stringify([dependsOnIds.trim()]);
      }
    }
    const parsedProgress = typeof progress === 'number'
      ? Math.max(0, Math.min(100, Math.round(progress)))
      : 0;

    // 2. Strict Collaboration Business Rule:
    // Newly created tickets ALWAYS have originSpaceId: null.
    // They belong solely to the target department spaceId and are NOT collaborated tickets yet.
    // Collaboration is triggered exclusively upon handoff transfer (POST /api/tasks/[id]/handoff or PATCH spaceId).
    const effectiveOriginSpaceId: string | null = null;

    // Parse pre-uploaded staged attachments
    const validStagedAttachments: Array<{
      fileName: string;
      fileUrl: string;
      fileType: string;
      fileSize: number;
    }> = [];

    if (Array.isArray(stagedAttachments)) {
      for (const att of stagedAttachments) {
        if (att && att.fileName && att.fileUrl) {
          validStagedAttachments.push({
            fileName: String(att.fileName).trim(),
            fileUrl: String(att.fileUrl).trim(),
            fileType: att.fileType ? String(att.fileType).trim() : 'application/octet-stream',
            fileSize: Math.max(0, Math.round(Number(att.fileSize || 0))),
          });
        }
      }
    }

    // 3. Single-Round-Trip Task Creation with collision-proof taskKey & nested relational writes
    const masterTasks = peekCache<any[]>('tasks:master:all');
    const { prefix: keyPrefix, nextNum: initialNum } = await getCollisionProofStartCounter(
      space.id,
      space.key,
      masterTasks ?? undefined
    );
    let candidateNum = initialNum;
    let newTask: any = null;
    let attempts = 0;

    while (attempts < 6) {
      attempts++;
      const candidateKey = `${keyPrefix}${candidateNum}`;
      spaceKeyCounters.set(space.key.toUpperCase(), candidateNum);
      try {
        newTask = await withDbRetry(async () =>
          prisma.task.create({
            data: {
              taskKey: candidateKey,
              title: String(title).trim(),
              description: description ? String(description).trim() : null,
              priority: taskPriority,
              statusId: finalStatusId,
              listId: list.id,
              spaceId: space.id,
              originSpaceId: effectiveOriginSpaceId, // Strictly null on creation
              assigneeId: assigneeId || null,
              createdById: user.id,
              customFields: customFieldsString,
              startDate: parsedStartDate && !isNaN(parsedStartDate.getTime()) ? parsedStartDate : null,
              dueDate: parsedDueDate && !isNaN(parsedDueDate.getTime()) ? parsedDueDate : null,
              isMilestone: parsedIsMilestone,
              dependsOnIds: parsedDependsOn,
              progress: parsedProgress,
              checklistItems: initialChecklist.length > 0 ? {
                create: initialChecklist.map((cTitle, idx) => ({
                  title: cTitle,
                  order: idx,
                })),
              } : undefined,
              customFieldValues: fieldEntries.length > 0 ? {
                create: fieldEntries.map((fe) => ({
                  fieldId: fe.fieldId,
                  value: fe.value,
                })),
              } : undefined,
              attachments: validStagedAttachments.length > 0 ? {
                create: validStagedAttachments.map((att) => ({
                  fileName: att.fileName,
                  fileUrl: att.fileUrl,
                  fileType: att.fileType,
                  fileSize: att.fileSize,
                  uploadedById: user.id,
                })),
              } : undefined,
              history: {
                create: [
                  {
                    actorId: user.id,
                    actionType: 'CREATED',
                    fromSpaceId: null,
                    toSpaceId: space.id,
                    toQueueName: list.name,
                    notes: `Ticket created in ${space.name} - ${list.name}`,
                  },
                  ...validStagedAttachments.map((att) => ({
                    actorId: user.id,
                    actionType: 'ATTACHMENT_UPLOAD',
                    fromSpaceId: space.id,
                    toSpaceId: space.id,
                    notes: `Uploaded attachment: ${att.fileName} (${(att.fileSize / 1024).toFixed(1)} KB)`,
                  })),
                ],
              },
            },
            include: {
              space: {
                include: {
                  customFields: {
                    include: {
                      list: { select: { id: true, name: true } },
                    },
                    orderBy: { order: 'asc' },
                  },
                  ticketTemplates: true,
                },
              },
              originSpace: { select: { id: true, name: true, key: true } },
              list: { select: { id: true, name: true } },
              status: { select: { id: true, name: true, color: true, order: true, isCompleted: true, isClosed: true } },
              createdBy: {
                select: {
                  id: true,
                  name: true,
                  username: true,
                  email: true,
                  globalRole: true,
                  spaceMemberships: {
                    include: {
                      space: { select: { id: true, name: true, key: true } },
                    },
                  },
                },
              },
              contributors: {
                select: {
                  id: true,
                  name: true,
                  username: true,
                },
              },
              checklistItems: { orderBy: { order: 'asc' } },
              attachments: {
                include: {
                  uploadedBy: { select: { id: true, name: true, username: true } },
                },
                orderBy: { createdAt: 'desc' },
              },
              _count: {
                select: {
                  comments: true,
                  attachments: true,
                  checklistItems: true,
                },
              },
              customFieldValues: {
                include: { field: true },
              },
            },
          })
        );
        break;
      } catch (err: any) {
        if (err?.code === 'P2002' && attempts < 6) {
          candidateNum += 1;
          continue;
        }
        throw err;
      }
    }

    const homeDept =
      newTask.createdBy?.spaceMemberships?.[0]?.space?.name ||
      (newTask.createdBy?.globalRole === 'EMPLOYEE' ? 'Employee' : 'General');

    const formattedTask = {
      ...newTask,
      createdBy: {
        ...newTask.createdBy,
        homeDepartment: homeDept,
      },
    };

    // 4. In-Place Server Cache Update (wrapped in try/catch so cache helpers never fail task creation)
    try {
      prependTaskToMasterStore(formattedTask);
      invalidateCachePrefix('spaces:');
      invalidateCachePrefix('notifications:user:');
    } catch (cacheErr) {
      console.warn('Cache update warning after task creation:', cacheErr);
    }

    // 5. Persist notifications and broadcasts before returning so Vercel Serverless never drops them
    try {
      await notifySpaceMembers({
        spaceId: space.id,
        excludeUserIds: [user.id],
        taskId: newTask.id,
        title: `New Ticket: ${newTask.taskKey}`,
        message: `New Ticket ${newTask.taskKey}: '${newTask.title}' submitted by ${user.name} (${homeDept})`,
      });

      const taskCreatedEvent = {
        type: 'TASK_CREATED',
        spaceId: space.id,
        listId: list.id,
        task: formattedTask,
        timestamp: new Date().toISOString(),
      };
      await broadcastToSpaceStaff(space.id, taskCreatedEvent, [user.id]);
    } catch (err) {
      console.warn('Notifications dispatch warning:', err);
    }

    return NextResponse.json({ success: true, task: formattedTask }, { status: 201 });
  } catch (error: any) {
    console.error('Failed to create task:', error);
    return NextResponse.json(
      {
        error: `Failed to create ticket: ${error?.message || 'An unexpected internal error occurred while creating the task.'}`,
        code: error?.code,
      },
      { status: 500 }
    );
  }
}
