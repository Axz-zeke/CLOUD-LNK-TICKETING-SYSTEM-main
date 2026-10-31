/**
 * Master In-Memory Task Store & Relation Join Engine
 * 
 * Retrieves and caches the entire enriched task dataset in Node.js server RAM
 * using a single PostgreSQL lateral/JSON join round-trip (relationJoins).
 */

import { prisma } from './db';
import { getOrSetCache, setCache, peekCache } from './server-cache';

interface MasterStoreStamp {
  maxUpdatedAtMs: number;
  count: number;
  checkedAt: number;
}

const GLOBAL_STAMP_KEY = '__lnk_master_task_stamp_v1__';
const masterStamp: MasterStoreStamp =
  (globalThis as any)[GLOBAL_STAMP_KEY] ||
  ((globalThis as any)[GLOBAL_STAMP_KEY] = {
    maxUpdatedAtMs: 0,
    count: -1,
    checkedAt: 0,
  });

function recordStampFromTasks(tasks: any[]) {
  let maxMs = 0;
  for (const t of tasks) {
    const ms = t.updatedAt ? new Date(t.updatedAt).getTime() : 0;
    if (ms > maxMs) maxMs = ms;
  }
  masterStamp.maxUpdatedAtMs = maxMs;
  masterStamp.count = tasks.length;
  masterStamp.checkedAt = Date.now();
}

export async function fetchMasterTaskList(forceFresh = false) {
  let effectiveForceFresh = forceFresh;

  // Cross-instance coherence check: if we have a warm cache entry in RAM, verify via a sub-5ms
  // single-row aggregate query whether another serverless instance mutated, created, or deleted a task.
  if (!effectiveForceFresh) {
    const cached = peekCache<any[]>('tasks:master:all');
    const isVercel = Boolean(process.env.VERCEL);
    const shouldVerifyStamp =
      cached && (isVercel || Date.now() - masterStamp.checkedAt > 2_000);

    if (shouldVerifyStamp) {
      try {
        const agg = await prisma.task.aggregate({
          _max: { updatedAt: true },
          _count: { _all: true },
        });
        const dbMaxMs = agg._max.updatedAt ? new Date(agg._max.updatedAt).getTime() : 0;
        const dbCount = agg._count._all;
        masterStamp.checkedAt = Date.now();

        if (
          dbMaxMs !== masterStamp.maxUpdatedAtMs ||
          dbCount !== masterStamp.count
        ) {
          effectiveForceFresh = true;
        }
      } catch {
        // Non-fatal: proceed with existing cache
      }
    }
  }

  return getOrSetCache(
    'tasks:master:all',
    60_000, // 60 seconds fresh TTL on-premise (capped to 2s + stamp verified on Vercel)
    async () => {
      const rawTasks = await prisma.task.findMany({
        relationLoadStrategy: 'join', // Single lateral/JSON join roundtrip in PostgreSQL
        include: {
          space: {
            include: {
              statuses: { orderBy: { order: 'asc' } },
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
            },
          },
          originSpace: {
            select: { id: true, name: true, key: true },
          },
          checklistItems: {
            orderBy: { order: 'asc' },
          },
          attachments: {
            include: {
              uploadedBy: { select: { id: true, name: true, username: true } },
            },
            orderBy: { createdAt: 'desc' },
          },
          customFieldValues: {
            include: { field: true },
          },
          list: {
            select: { id: true, name: true, isPrivate: true, spaceId: true },
          },
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
          assignee: {
            select: { id: true, name: true, username: true, email: true },
          },
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
          _count: {
            select: {
              comments: true,
              attachments: true,
            },
          },
          history: {
            select: {
              id: true,
              actionType: true,
              fromSpaceId: true,
              toSpaceId: true,
              createdAt: true,
              fromSpace: { select: { id: true, name: true, key: true } },
              toSpace: { select: { id: true, name: true, key: true } },
              actor: {
                select: {
                  id: true,
                  name: true,
                  spaceMemberships: { select: { spaceId: true } },
                  headedSpaces: { select: { id: true } },
                },
              },
            },
          },
          contributors: {
            select: {
              id: true,
              name: true,
              username: true,
              spaceMemberships: { select: { spaceId: true } },
              headedSpaces: { select: { id: true } },
            },
          },
        },
        orderBy: [
          { updatedAt: 'desc' },
          { createdAt: 'desc' },
        ],
      });

      const enriched = rawTasks.map((t) => {
        const homeDept =
          t.createdBy?.spaceMemberships?.[0]?.space?.name ||
          (t.createdBy?.globalRole === 'EMPLOYEE' ? 'Employee' : 'General');
        return {
          ...t,
          createdBy: {
            ...t.createdBy,
            homeDepartment: homeDept,
          },
        };
      });
      recordStampFromTasks(enriched);
      return enriched;
    },
    {
      swrMs: 300_000, // 5 minutes stale-while-revalidate window
      forceFresh: effectiveForceFresh,
    }
  );
}

/**
 * Updates a task in-place inside the server's in-memory 'tasks:master:all' cache.
 * Avoids cache wipe and ensures the very next GET /api/tasks request returns the updated state in < 0.1ms.
 */
export function updateTaskInMasterStore(updatedTask: any): void {
  const cached = peekCache<any[]>('tasks:master:all');
  if (!cached || !Array.isArray(cached)) return;

  const idx = cached.findIndex((t) => t.id === updatedTask.id);
  if (idx !== -1) {
    const existing = cached[idx];
    const merged = {
      ...existing,
      ...updatedTask,
      status: updatedTask.status || existing.status,
      space: updatedTask.space || existing.space,
      list: updatedTask.list || existing.list,
      assignee: updatedTask.assignee !== undefined ? updatedTask.assignee : existing.assignee,
      createdBy: updatedTask.createdBy || existing.createdBy,
      originSpace: updatedTask.originSpace !== undefined ? updatedTask.originSpace : existing.originSpace,
      contributors: updatedTask.contributors || existing.contributors,
      history: updatedTask.history || existing.history,
      updatedAt: updatedTask.updatedAt || new Date().toISOString(),
    };
    cached[idx] = merged;
    setCache('tasks:master:all', cached, 60_000);
    recordStampFromTasks(cached);
  } else {
    const next = [updatedTask, ...cached];
    setCache('tasks:master:all', next, 60_000);
    recordStampFromTasks(next);
  }
}

/**
 * Prepends a newly created task into the server's in-memory 'tasks:master:all' cache.
 */
export function prependTaskToMasterStore(newTask: any): void {
  const cached = peekCache<any[]>('tasks:master:all');
  if (!cached || !Array.isArray(cached)) return;

  const filtered = cached.filter((t) => t.id !== newTask.id);
  const next = [newTask, ...filtered];
  setCache('tasks:master:all', next, 60_000);
  recordStampFromTasks(next);
}

/**
 * Removes a task from the server's in-memory 'tasks:master:all' cache.
 */
export function removeTaskFromMasterStore(taskId: string): void {
  const cached = peekCache<any[]>('tasks:master:all');
  if (!cached || !Array.isArray(cached)) return;

  const filtered = cached.filter((t) => t.id !== taskId);
  setCache('tasks:master:all', filtered, 60_000);
  recordStampFromTasks(filtered);
}

/**
 * Appends newly uploaded attachment(s) to a task in-place inside 'tasks:master:all'.
 * Ensures immediate sub-millisecond visibility across GET /api/tasks without waiting for cache refresh.
 */
export function appendAttachmentsToMasterStore(taskId: string, newAttachments: any[]): void {
  const cached = peekCache<any[]>('tasks:master:all');
  if (!cached || !Array.isArray(cached) || !Array.isArray(newAttachments) || newAttachments.length === 0) return;

  const idx = cached.findIndex((t) => t.id === taskId);
  if (idx !== -1) {
    const existing = cached[idx];
    const currentAttachments = Array.isArray(existing.attachments) ? existing.attachments : [];
    const newIds = new Set(newAttachments.map((a) => a.id));
    const mergedAttachments = [
      ...newAttachments,
      ...currentAttachments.filter((a: any) => !newIds.has(a.id)),
    ];

    cached[idx] = {
      ...existing,
      attachments: mergedAttachments,
      _count: {
        ...existing._count,
        attachments: mergedAttachments.length,
      },
      updatedAt: new Date().toISOString(),
    };
    setCache('tasks:master:all', cached, 60_000);
  }
}

