/**
 * Automatic Background Cache Pre-Warmer
 * 
 * Automatically pre-warms 'tasks:master:all' and department spaces
 * so data is already hot in Node.js RAM before the user clicks.
 */

import { fetchMasterTaskList } from './task-store';
import { prisma } from './db';
import { getOrSetCache } from './server-cache';

let isWarmUpScheduled = false;

/**
 * Pre-warms tasks and spaces master datasets in the background.
 */
export async function warmServerCaches(): Promise<void> {
  try {
    await Promise.all([
      fetchMasterTaskList().catch((err) => {
        console.warn('[CacheWarmer] Failed to warm master tasks:', err?.message || err);
      }),
      getOrSetCache(
        'spaces:master',
        120_000,
        async () => {
          return prisma.space.findMany({
            relationLoadStrategy: 'join',
            include: {
              departmentHead: {
                select: { id: true, name: true, username: true, email: true },
              },
              members: {
                select: { userId: true, role: true },
              },
              lists: {
                orderBy: { order: 'asc' },
                select: {
                  id: true,
                  spaceId: true,
                  name: true,
                  description: true,
                  color: true,
                  order: true,
                  isPrivate: true,
                },
              },
              statuses: {
                orderBy: { order: 'asc' },
                select: {
                  id: true,
                  spaceId: true,
                  name: true,
                  color: true,
                  order: true,
                  isCompleted: true,
                  isClosed: true,
                },
              },
            },
            orderBy: { name: 'asc' },
          });
        },
        { swrMs: 600_000 }
      ).catch((err) => {
        console.warn('[CacheWarmer] Failed to warm master spaces:', err?.message || err);
      }),
    ]);
  } catch (err) {
    console.warn('[CacheWarmer] Background pre-warm failed:', err);
  }
}

/**
 * Initiates cache warm-up once in the background.
 */
export function ensureWarmCache(): void {
  if (isWarmUpScheduled) return;
  isWarmUpScheduled = true;
  void warmServerCaches().catch(() => {});
}
