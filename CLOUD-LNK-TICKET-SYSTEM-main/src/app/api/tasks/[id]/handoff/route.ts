import { NextRequest, NextResponse } from 'next/server';
import { prisma, withDbRetry, DB_TRANSACTION_OPTIONS } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { assertTaskAccess } from '@/lib/security/query-guard';
import { ForbiddenError } from '@/lib/security/rbac';
import { broadcastToSpaceStaff } from '@/lib/sse-broker';
import { fanOutCollaborationNotification } from '@/lib/collaboration';
import { invalidateCachePrefix } from '@/lib/server-cache';
import { fetchMasterTaskList, updateTaskInMasterStore } from '@/lib/task-store';

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

interface TicketHandoffPayload {
  action: 'CLOSE' | 'TRANSFER';
  targetSpaceId?: string;
  targetListId?: string;
  notes?: string;
}

async function handleHandoff(
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

    // Layer 2 Clearance assertion
    const currentTask = await assertTaskAccess(taskId, user, { ipAddress, db: prisma });
    if (!currentTask) {
      return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
    }

    // Defense-in-depth: Requesters cannot initiate inter-department handoffs or closure transitions
    const isSpaceStaff =
      user.globalRole === 'SUPERADMIN' ||
      (user.globalRole === 'ADMIN' &&
        Boolean(
          await prisma.spaceMember.findUnique({
            where: {
              spaceId_userId: {
                spaceId: currentTask.spaceId,
                userId: user.id,
              },
            },
          })
        ));

    if (!isSpaceStaff) {
      return NextResponse.json(
        { error: 'Forbidden: Only department staff or Superadmins can initiate ticket handoffs or closures.' },
        { status: 403 }
      );
    }

    const body: TicketHandoffPayload = await request.json();
    const { action, targetSpaceId, targetListId, notes } = body;

    if (!action || (action !== 'CLOSE' && action !== 'TRANSFER')) {
      return NextResponse.json(
        { error: "Invalid action. Must be 'CLOSE' or 'TRANSFER'." },
        { status: 400 }
      );
    }

    const result = await withDbRetry(() =>
      prisma.$transaction(async (tx) => {
        // 1. Retrieve current ticket, space, and list state
      const task = await tx.task.findUnique({
        where: { id: taskId },
        include: {
          space: true,
          list: true,
          status: true,
          contributors: { select: { id: true } },
        },
      });

      if (!task) {
        throw new Error('Task not found.');
      }

      if (action === 'TRANSFER') {
        if (!targetSpaceId) {
          throw new Error('targetSpaceId is required for handoff transfer.');
        }

        const targetSpace = await tx.space.findUnique({
          where: { id: targetSpaceId },
          include: {
            statuses: { orderBy: { order: 'asc' } },
            lists: { orderBy: { order: 'asc' } },
          },
        });

        if (!targetSpace) {
          throw new Error('Target department space not found.');
        }

        // Fetch the default OPEN status ID for targetSpaceId
        const targetOpenStatus =
          targetSpace.statuses.find((s) => !s.isCompleted && !s.isClosed) ||
          targetSpace.statuses[0];

        if (!targetOpenStatus) {
          throw new Error('Target space has no configured statuses.');
        }

        // Determine target list
        let chosenList = targetSpace.lists[0];
        if (targetListId) {
          const listMatch = targetSpace.lists.find((l) => l.id === targetListId);
          if (listMatch) {
            // Check private queue permissions
            if (listMatch.isPrivate) {
              const isSuperadmin = user.globalRole === 'SUPERADMIN';
              const isHead = targetSpace.departmentHeadId === user.id;
              const isMember =
                isSuperadmin ||
                isHead ||
                Boolean(
                  await tx.spaceMember.findUnique({
                    where: {
                      spaceId_userId: {
                        spaceId: targetSpace.id,
                        userId: user.id,
                      },
                    },
                  })
                );

              if (!isMember) {
                // If user doesn't have access to private queue, fallback to first public queue
                const publicList = targetSpace.lists.find((l) => !l.isPrivate);
                if (publicList) {
                  chosenList = publicList;
                } else {
                  throw new Error('Access denied to private queue in target space.');
                }
              } else {
                chosenList = listMatch;
              }
            } else {
              chosenList = listMatch;
            }
          }
        } else {
          // Default to first public queue if available
          const publicList = targetSpace.lists.find((l) => !l.isPrivate);
          if (publicList) {
            chosenList = publicList;
          }
        }

        if (!chosenList) {
          throw new Error('Target department space has no available queues.');
        }

        const updatedTask = await tx.task.update({
          where: { id: taskId },
          data: {
            spaceId: targetSpace.id,
            originSpaceId: (task as any).originSpaceId || task.spaceId,
            listId: chosenList.id,
            statusId: targetOpenStatus.id,
            contributors: {
              connect: { id: user.id },
            },
          },
          include: {
            space: true,
            originSpace: true,
            list: true,
            status: true,
            contributors: {
              select: {
                id: true,
                username: true,
                name: true,
                email: true,
                globalRole: true,
              },
            },
          },
        });

        // Record TicketHistory
        const historyRecord = await tx.taskHistory.create({
          data: {
            taskId,
            actorId: user.id,
            actionType: 'HANDOFF_TRANSFER',
            fromSpaceId: task.spaceId,
            toSpaceId: targetSpace.id,
            fromQueueName: task.list?.name || 'Unassigned',
            toQueueName: chosenList.name,
            notes: notes ? String(notes).trim() : null,
          },
          include: {
            actor: {
              select: {
                id: true,
                username: true,
                name: true,
                email: true,
                globalRole: true,
              },
            },
            fromSpace: { select: { id: true, name: true, key: true } },
            toSpace: { select: { id: true, name: true, key: true } },
          },
        });

        return { task: updatedTask, history: historyRecord, action: 'TRANSFER' };
      } else {
        // action === 'CLOSE'
        // Find closed / completed status in current space
        const currentSpaceStatuses = await tx.taskStatus.findMany({
          where: { spaceId: task.spaceId },
          orderBy: { order: 'asc' },
        });

        const closedStatus =
          currentSpaceStatuses.find((s) => s.isClosed) ||
          currentSpaceStatuses.find((s) => s.isCompleted) ||
          currentSpaceStatuses[currentSpaceStatuses.length - 1];

        if (!closedStatus) {
          throw new Error('No closed status found for current space.');
        }

        const updatedTask = await tx.task.update({
          where: { id: taskId },
          data: {
            statusId: closedStatus.id,
            contributors: {
              connect: { id: user.id },
            },
          },
          include: {
            space: true,
            list: true,
            status: true,
            contributors: {
              select: {
                id: true,
                username: true,
                name: true,
                email: true,
                globalRole: true,
              },
            },
          },
        });

        const historyRecord = await tx.taskHistory.create({
          data: {
            taskId,
            actorId: user.id,
            actionType: 'CLOSED',
            fromSpaceId: task.spaceId,
            toSpaceId: task.spaceId,
            fromQueueName: task.list?.name || null,
            toQueueName: task.list?.name || null,
            notes: notes ? String(notes).trim() : null,
          },
          include: {
            actor: {
              select: {
                id: true,
                username: true,
                name: true,
                email: true,
                globalRole: true,
              },
            },
            fromSpace: { select: { id: true, name: true, key: true } },
            toSpace: { select: { id: true, name: true, key: true } },
          },
        });

        return { task: updatedTask, history: historyRecord, action: 'CLOSE' };
      }
    }, DB_TRANSACTION_OPTIONS)
  );

    // Notify origin, target, and all collaborating spaces with fan-out notifications & SSE
    try {
      await fanOutCollaborationNotification({
        taskId,
        actor: {
          id: user.id,
          name: user.name || user.username,
        },
        type: result.action === 'TRANSFER' ? 'TRANSFER' : 'STATUS_CHANGE',
        targetSpaceName: result.action === 'TRANSFER' ? result.task.space?.name : undefined,
        newStatusName: result.task.status?.name,
        broadcastPayload: {
          type: 'TASK_UPDATED',
          spaceId: result.task.spaceId,
          listId: result.task.listId,
          task: result.task,
          action: result.action,
          timestamp: new Date().toISOString(),
        },
      });

      broadcastToSpaceStaff(currentTask.spaceId, {
        type: 'task:updated',
        taskId,
        action: result.action,
      });
      if (result.action === 'TRANSFER' && body.targetSpaceId && body.targetSpaceId !== currentTask.spaceId) {
        broadcastToSpaceStaff(body.targetSpaceId, {
          type: 'task:created',
          taskId,
          action: 'HANDOFF_RECEIVED',
        });
      }
    } catch (e) {
      // Non-fatal SSE notification error
      console.warn('SSE broadcast warning:', e);
    }

    // Update server master in-memory cache in-place (0ms latency for subsequent queries)
    updateTaskInMasterStore(result.task);
    invalidateCachePrefix(`task:detail:${taskId}`);
    invalidateCachePrefix('spaces:');
    invalidateCachePrefix('notifications:user:');

    return NextResponse.json({
      success: true,
      task: result.task,
      history: result.history,
    });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error('Failed to process handoff:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error processing handoff' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return handleHandoff(request, context);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return handleHandoff(request, context);
}
