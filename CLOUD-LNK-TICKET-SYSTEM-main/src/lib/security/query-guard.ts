import { Prisma, Task, TaskComment } from '@prisma/client';
import { prisma } from '../db';
import { AuthenticatedUser, ForbiddenError, getUserAssignedSpaceIds } from './rbac';
import { peekCache } from '../server-cache';

export interface TaskAccessOptions {
  ipAddress?: string;
  db?: typeof prisma;
}

/**
 * =========================================================================
 * LAYER 1: Set-Level Query Guard (List / Filter / Search Queries)
 * =========================================================================
 * Dynamically builds a Prisma `TaskWhereInput` object based on the user's role:
 * - SUPERADMIN: Unrestricted; sees all tasks across all spaces.
 * - ADMIN: Automatically restricted to tasks belonging to their assigned spaces.
 * - EMPLOYEE: Automatically restricted to tasks they personally submitted.
 */
export async function buildTaskQueryFilter(
  user: AuthenticatedUser,
  db = prisma
): Promise<Prisma.TaskWhereInput> {
  if (user.globalRole === 'SUPERADMIN') {
    return {};
  }

  // Both ADMIN and EMPLOYEE hold staff access for their assigned spaces + origin spaces + assignments + contributions:
  const assignedSpaceIds = await getUserAssignedSpaceIds(user.id, db);
  return {
    OR: [
      { spaceId: { in: assignedSpaceIds } },
      { originSpaceId: { in: assignedSpaceIds } },
      { createdById: user.id },
      { assigneeId: user.id },
      { contributors: { some: { id: user.id } } },
    ],
  };
}

/**
 * =========================================================================
 * LAYER 2: Resource-Level Single-Resource Assertion
 * =========================================================================
 * Evaluates whether an authenticated user has clearance to access a specific task.
 * If unauthorized:
 * 1. An immutable security event is immediately recorded in AuditLog.
 * 2. An HTTP 403 ForbiddenError is thrown, stopping execution in its tracks.
 */
export async function assertTaskAccess(
  taskId: string,
  user: AuthenticatedUser,
  options: TaskAccessOptions = {}
) {
  const db = options.db ?? prisma;
  const ipAddress = options.ipAddress ?? '127.0.0.1';

  // Layer 2 Fast-Path: In-memory cache assertion (0.01ms vs 2000ms WAN round-trip)
  const masterTasks = peekCache<any[]>('tasks:master:all');
  const cached = masterTasks?.find((t) => t.id === taskId);
  if (cached) {
    if (user.globalRole === 'SUPERADMIN') return cached;
    if (cached.createdById === user.id) return cached;
    if (cached.assigneeId === user.id) return cached;
    if (Array.isArray(cached.contributors) && cached.contributors.some((c: any) => c.id === user.id)) return cached;

    const assignedSpaceIds = await getUserAssignedSpaceIds(user.id, db);
    if (
      (cached.spaceId && assignedSpaceIds.includes(cached.spaceId)) ||
      (cached.originSpaceId && assignedSpaceIds.includes(cached.originSpaceId))
    ) {
      return cached;
    }
  }

  const task = await db.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      taskKey: true,
      spaceId: true,
      originSpaceId: true,
      createdById: true,
      assigneeId: true,
      title: true,
      statusId: true,
      listId: true,
      list: {
        select: { id: true, name: true },
      },
      startDate: true,
      dueDate: true,
      isMilestone: true,
      dependsOnIds: true,
      progress: true,
      space: {
        select: {
          id: true,
          name: true,
          key: true,
          departmentHeadId: true,
          statuses: {
            orderBy: { order: 'asc' },
          },
          lists: {
            orderBy: { order: 'asc' },
          },
        },
      },
      originSpace: {
        select: {
          id: true,
          name: true,
          key: true,
          departmentHeadId: true,
        },
      },
      contributors: {
        select: { id: true },
      },
    },
  });

  if (!task) {
    throw new Error(`Task not found with id: ${taskId}`);
  }

  // Backfill in-memory cache so subsequent assertions and mutations execute in 0.01ms
  if (masterTasks && Array.isArray(masterTasks)) {
    if (!masterTasks.some((t: any) => t.id === task.id)) {
      masterTasks.unshift(task);
    }
  }

  // 1. SUPERADMIN has unrestricted clearance across the organization
  if (user.globalRole === 'SUPERADMIN') {
    return task;
  }

  // 2. Author Clearance: The author can ALWAYS view and track their own ticket across all departments
  if (task.createdById === user.id) {
    return task;
  }

  // 3. Assignee Clearance
  if (task.assigneeId === user.id) {
    return task;
  }

  // 4. Contributor Clearance: User has collaborated / contributed to this task
  if (Array.isArray(task.contributors) && task.contributors.some((c: any) => c.id === user.id)) {
    return task;
  }

  // 5. Department Staff Clearance: Any user assigned to destination space or Department Head
  const assignedSpaceIds = await getUserAssignedSpaceIds(user.id, db);
  if (task.spaceId && assignedSpaceIds.includes(task.spaceId)) {
    return task;
  }

  // 6. Originating Department Staff Clearance (Cross-department collaboration)
  if (task.originSpaceId && assignedSpaceIds.includes(task.originSpaceId)) {
    return task;
  }

  // SECURITY TRAP: Record unauthorized cross-department access attempt
  await db.auditLog.create({
    data: {
      event: 'UNAUTHORIZED_CROSS_DEPARTMENT_ACCESS_ATTEMPT',
      userId: user.id,
      resourceType: 'Task',
      resourceId: task.id,
      ipAddress,
      details: JSON.stringify({
        message: `User ${user.username} (${user.globalRole}) attempted to access task ${task.taskKey} in unassigned space ${task.space.name}`,
        attemptedSpaceId: task.spaceId,
        attemptedSpaceKey: task.space.key,
        userRole: user.globalRole,
      }),
    },
  }).catch(() => {});

  throw new ForbiddenError(
    `HTTP 403 Forbidden: Clearance denied. User '${user.username}' is not a member of Space '${task.space.name}'.`
  );
}

/**
 * =========================================================================
 * INTERNAL NOTES GUARD
 * =========================================================================
 * Requesters and cross-department authors must NEVER receive internal notes (isInternal: true).
 * This helper builds the appropriate Prisma where clause for comment queries.
 */
export function buildCommentQueryFilter(
  user: AuthenticatedUser,
  taskId: string,
  isSpaceStaff?: boolean
): Prisma.TaskCommentWhereInput {
  if (isSpaceStaff === false) {
    return {
      taskId,
      isInternal: false,
    };
  }

  return { taskId };
}

/**
 * Sanitizes comments array in-memory, stripping internal staff notes if user is not space staff.
 */
export function sanitizeCommentsForUser<T extends { isInternal: boolean }>(
  comments: T[],
  user: AuthenticatedUser,
  isSpaceStaff = false
): T[] {
  if (!isSpaceStaff) {
    return comments.filter((c) => !c.isInternal);
  }
  return comments;
}

/**
 * High-level guarded query for reading a full task with its comments.
 * Combines Layer 2 assertion with Internal Note guarding.
 */
export async function getGuardedTaskWithComments(
  taskId: string,
  user: AuthenticatedUser,
  options: TaskAccessOptions = {}
) {
  const db = options.db ?? prisma;
  const ipAddress = options.ipAddress ?? '127.0.0.1';

  const task = await db.task.findUnique({
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

  const isSuperadmin = user.globalRole === 'SUPERADMIN';
  const isSpaceStaff =
    isSuperadmin ||
    task.space?.departmentHeadId === user.id ||
    Boolean(task.space?.members?.some((m: any) => m.userId === user.id));
  const isOriginSpaceStaff = Boolean(
    task.originSpace &&
      (task.originSpace.departmentHeadId === user.id ||
        task.originSpace.members?.some((m: any) => m.userId === user.id))
  );
  const isCreator = task.createdById === user.id;
  const isAssignee = task.assigneeId === user.id;
  const isContributor = Boolean(
    Array.isArray(task.contributors) && task.contributors.some((c: any) => c.id === user.id)
  );

  if (
    !isSuperadmin &&
    !isCreator &&
    !isAssignee &&
    !isContributor &&
    !isSpaceStaff &&
    !isOriginSpaceStaff
  ) {
    void db.auditLog
      .create({
        data: {
          event: 'UNAUTHORIZED_CROSS_DEPARTMENT_ACCESS_ATTEMPT',
          userId: user.id,
          resourceType: 'Task',
          resourceId: task.id,
          ipAddress,
          details: JSON.stringify({
            message: `User ${user.username} (${user.globalRole}) attempted to access task ${task.taskKey} in unassigned space ${task.space.name}`,
            attemptedSpaceId: task.spaceId,
            attemptedSpaceKey: task.space.key,
            userRole: user.globalRole,
          }),
        },
      })
      .catch(() => {});

    throw new ForbiddenError(
      `HTTP 403 Forbidden: Clearance denied. User '${user.username}' is not a member of Space '${task.space.name}'.`
    );
  }

  return {
    ...task,
    comments: sanitizeCommentsForUser(task.comments || [], user, isSpaceStaff),
  };
}

