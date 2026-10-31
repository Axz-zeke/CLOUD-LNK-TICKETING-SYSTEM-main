import { Prisma, PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/db';
import { getUserAssignedSpaceIds } from '@/lib/security/rbac';
import { ACTIVE_TASK_STATUS_FILTER } from '@/lib/status-utils';
import { createNotification, createNotificationsBatch } from '@/lib/notifications';
import { broadcastToUsers } from '@/lib/sse-broker';

import {
  type TaskCollaborationInfo,
  computeTaskCollaboration,
} from './collaboration-utils';

export {
  type TaskCollaborationInfo,
  computeTaskCollaboration,
};

/**
 * Builds the Prisma where filter for querying collaborated tickets according to user clearance.
 */
export async function buildCollaboratedTaskFilter(
  user: { id: string; globalRole: string },
  prismaClient: PrismaClient = defaultPrisma as any
): Promise<Prisma.TaskWhereInput> {
  if (user.globalRole === 'SUPERADMIN') {
    return {
      OR: [
        {
          originSpaceId: { not: null },
        },
        {
          history: {
            some: {
              actionType: 'HANDOFF_TRANSFER',
              fromSpaceId: { not: null },
              toSpaceId: { not: null },
            },
          },
        },
        {
          contributors: {
            some: {},
          },
        },
      ],
    };
  }

  const userSpaceIds = await getUserAssignedSpaceIds(user.id, prismaClient);
  if (!userSpaceIds || userSpaceIds.length === 0) {
    // If user has no assigned space clearance, they cannot access any department collaborated tickets
    return { id: '__no_access__' };
  }

  return {
    OR: [
      // 0. Ticket originated in user's space(s) and is currently in a different space
      {
        originSpaceId: { in: userSpaceIds },
      },
      // 1. Ticket has handoff history involving user's space(s)
      {
        history: {
          some: {
            actionType: 'HANDOFF_TRANSFER',
            OR: [
              { fromSpaceId: { in: userSpaceIds } },
              { toSpaceId: { in: userSpaceIds } },
            ],
          },
        },
      },
      // 2. Ticket has contributors from user's space(s)
      {
        contributors: {
          some: {
            OR: [
              { spaceMemberships: { some: { spaceId: { in: userSpaceIds } } } },
              { headedSpaces: { some: { id: { in: userSpaceIds } } } },
            ],
          },
        },
      },
      // 3. Ticket has history actor from user's space(s)
      {
        history: {
          some: {
            actor: {
              OR: [
                { spaceMemberships: { some: { spaceId: { in: userSpaceIds } } } },
                { headedSpaces: { some: { id: { in: userSpaceIds } } } },
              ],
            },
          },
        },
      },
    ],
  };
}

/**
 * Computes the total count of active/open collaborated tickets visible to the user's department clearance.
 */
export async function getCollaboratedActiveCount(
  user: { id: string; globalRole: string },
  prismaClient: PrismaClient = defaultPrisma as any
): Promise<number> {
  const isSuperadmin = user.globalRole === 'SUPERADMIN';
  const userSpaceIds = isSuperadmin ? [] : await getUserAssignedSpaceIds(user.id, prismaClient);

  if (!isSuperadmin && userSpaceIds.length === 0) {
    return 0;
  }

  const baseFilter = await buildCollaboratedTaskFilter(user, prismaClient);

  const candidateTasks = await prismaClient.task.findMany({
    where: {
      AND: [baseFilter, ACTIVE_TASK_STATUS_FILTER],
    },
    select: {
      id: true,
      spaceId: true,
      space: { select: { id: true, name: true, key: true } },
      history: {
        where: { actionType: 'HANDOFF_TRANSFER' },
        select: {
          actionType: true,
          fromSpaceId: true,
          toSpaceId: true,
          createdAt: true,
          fromSpace: { select: { id: true, name: true, key: true } },
          toSpace: { select: { id: true, name: true, key: true } },
          actor: {
            select: {
              id: true,
              spaceMemberships: { select: { spaceId: true } },
              headedSpaces: { select: { id: true } },
            },
          },
        },
      },
      contributors: {
        select: {
          id: true,
          spaceMemberships: { select: { spaceId: true } },
          headedSpaces: { select: { id: true } },
        },
      },
      createdBy: {
        select: {
          id: true,
          spaceMemberships: {
            select: {
              spaceId: true,
              space: { select: { id: true, name: true, key: true } },
            },
          },
        },
      },
    },
  });

  let count = 0;
  for (const t of candidateTasks) {
    const collab = computeTaskCollaboration(t as any, userSpaceIds);
    if (!collab.isCollaborated) continue;

    if (isSuperadmin) {
      count++;
    } else if (collab.participatingSpaceIds.some((sid: string) => userSpaceIds.includes(sid))) {
      count++;
    }
  }

  return count;
}

export interface FanOutNotificationParams {
  taskId: string;
  actor: {
    id: string;
    name: string;
    departmentName?: string;
  };
  type: 'STATUS_CHANGE' | 'TRANSFER' | 'PRIORITY_CHANGE' | 'ASSIGNEE_CHANGE' | 'GENERAL' | 'UPDATE';
  newStatusName?: string;
  targetSpaceName?: string;
  customTitle?: string;
  customMessage?: string;
  broadcastPayload?: any;
  prismaClient?: PrismaClient;
}

export async function fanOutCollaborationNotification(
  params: FanOutNotificationParams
): Promise<{ recipientCount: number; recipientUserIds: string[] }> {
  const {
    taskId,
    actor,
    type,
    newStatusName,
    targetSpaceName,
    customTitle,
    customMessage,
    broadcastPayload,
    prismaClient = defaultPrisma as any,
  } = params;

  // 1. Fetch task details including space, originSpace, createdBy, assignee, history, contributors
  const task = await prismaClient.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      taskKey: true,
      title: true,
      spaceId: true,
      originSpaceId: true,
      createdById: true,
      assigneeId: true,
      space: { select: { id: true, name: true, departmentHeadId: true } },
      originSpace: { select: { id: true, name: true, departmentHeadId: true } },
      history: {
        select: {
          fromSpaceId: true,
          toSpaceId: true,
          actionType: true,
          actorId: true,
        },
      },
      contributors: {
        select: { id: true },
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          spaceMemberships: {
            select: {
              spaceId: true,
              space: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  if (!task) return { recipientCount: 0, recipientUserIds: [] };

  // 2. Collect all involved space IDs
  const involvedSpaceIds = new Set<string>();
  if (task.spaceId) involvedSpaceIds.add(task.spaceId);
  if (task.originSpaceId) involvedSpaceIds.add(task.originSpaceId);

  // Collaboration trail from history
  for (const h of task.history || []) {
    if (h.fromSpaceId) involvedSpaceIds.add(h.fromSpaceId);
    if (h.toSpaceId) involvedSpaceIds.add(h.toSpaceId);
  }

  // Fallback for origin if originSpaceId was not set
  if (!task.originSpaceId) {
    const firstHandoff = (task.history || []).find(
      (h: any) => h.actionType === 'HANDOFF_TRANSFER' && h.fromSpaceId
    );
    if (firstHandoff?.fromSpaceId) {
      involvedSpaceIds.add(firstHandoff.fromSpaceId);
    } else if (task.createdBy?.spaceMemberships?.[0]?.spaceId) {
      involvedSpaceIds.add(task.createdBy.spaceMemberships[0].spaceId);
    }
  }

  // 3. Gather active members, department leads, and actor's department in a single parallel batch
  const recipientUserIds = new Set<string>();
  const spaceIdsArr = Array.from(involvedSpaceIds);

  const [members, spaces, actorHead, actorMember] = await Promise.all([
    spaceIdsArr.length > 0
      ? prismaClient.spaceMember.findMany({
          where: { spaceId: { in: spaceIdsArr } },
          select: { userId: true },
        })
      : Promise.resolve([]),
    spaceIdsArr.length > 0
      ? prismaClient.space.findMany({
          where: { id: { in: spaceIdsArr }, departmentHeadId: { not: null } },
          select: { departmentHeadId: true },
        })
      : Promise.resolve([]),
    !actor.departmentName
      ? prismaClient.space.findFirst({
          where: { departmentHeadId: actor.id },
          select: { name: true },
        })
      : Promise.resolve(null),
    !actor.departmentName
      ? prismaClient.spaceMember.findFirst({
          where: { userId: actor.id },
          include: { space: { select: { name: true } } },
        })
      : Promise.resolve(null),
  ]);

  for (const m of members) {
    if (m.userId) recipientUserIds.add(m.userId);
  }
  for (const s of spaces) {
    if (s.departmentHeadId) recipientUserIds.add(s.departmentHeadId);
  }

  // 4. Add direct stakeholders: creator, assignee, contributors
  if (task.createdById) recipientUserIds.add(task.createdById);
  if (task.assigneeId) recipientUserIds.add(task.assigneeId);
  if (task.contributors && Array.isArray(task.contributors)) {
    for (const c of task.contributors) {
      if (c.id) recipientUserIds.add(c.id);
    }
  }

  // 5. Exclude the actor who triggered the mutation so they don't notify themselves!
  recipientUserIds.delete(actor.id);

  // 6. Resolve Actor's department name
  const actorDept =
    actor.departmentName ||
    actorHead?.name ||
    actorMember?.space?.name ||
    task.space?.name ||
    'Department';

  // 7. Check if this is a collaborated ticket
  const isCollab =
    (task.originSpaceId && task.originSpaceId !== task.spaceId) ||
    (task.history && task.history.some((h: any) => h.actionType === 'HANDOFF_TRANSFER')) ||
    involvedSpaceIds.size > 1;

  // 8. Format title and message
  let title = customTitle;
  let message = customMessage;

  if (!title || !message) {
    if (type === 'STATUS_CHANGE') {
      title = isCollab ? `[Collab Update] ${task.taskKey}` : `Status Changed: ${task.taskKey}`;
      message = isCollab
        ? `[Collab Update] ${task.taskKey} ('${task.title}') status changed to ${newStatusName || 'Updated'} by ${actor.name} (${actorDept})`
        : `${task.taskKey} status changed to '${newStatusName || 'Updated'}' by ${actor.name}`;
    } else if (type === 'TRANSFER') {
      title = `[Collab Update] ${task.taskKey}`;
      message = `[Collab Update] ${task.taskKey} ('${task.title}') transferred to ${targetSpaceName || 'new department'} by ${actor.name} (${actorDept})`;
    } else if (type === 'PRIORITY_CHANGE') {
      title = isCollab ? `[Collab Update] ${task.taskKey}` : `Priority Changed: ${task.taskKey}`;
      message = isCollab
        ? `[Collab Update] ${task.taskKey} ('${task.title}') priority changed by ${actor.name} (${actorDept})`
        : `${task.taskKey} priority updated by ${actor.name}`;
    } else {
      title = isCollab ? `[Collab Update] ${task.taskKey}` : `Ticket Updated: ${task.taskKey}`;
      message = isCollab
        ? `[Collab Update] ${task.taskKey} ('${task.title}') updated by ${actor.name} (${actorDept})`
        : `${task.taskKey} updated by ${actor.name}`;
    }
  }

  // 9. Dispatch in-app notifications to all deduplicated recipients in a single batch query
  const finalRecipientIds = Array.from(recipientUserIds);
  const taskSnippet = { id: task.id, taskKey: task.taskKey, title: task.title };
  await createNotificationsBatch(
    finalRecipientIds.map((uid) => ({
      userId: uid,
      taskId: task.id,
      title: title!,
      message: message!,
      taskSnippet,
    }))
  ).catch((e) => {
    console.error('Failed to dispatch batch notifications:', e);
  });

  // 10. Broadcast operational event to all involved users via SSE
  if (broadcastPayload) {
    try {
      broadcastToUsers(finalRecipientIds, broadcastPayload);
    } catch (e) {
      console.warn('Failed to broadcast payload to users:', e);
    }
  }

  return { recipientCount: finalRecipientIds.length, recipientUserIds: finalRecipientIds };
}
