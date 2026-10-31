import { prisma } from './db';

/**
 * Air-Gapped Unified Real-Time LAN Event Pipeline & SSE Pub/Sub Hub
 * 
 * Manages active Server-Sent Events (SSE) connections mapped by userId.
 * Supports multi-client broadcasting (<100ms latency), typed operational events
 * (tasks, updates, comments, notifications), and strict RBAC isolation.
 */

type ClientController = ReadableStreamDefaultController;

// Global singleton attached to globalThis to survive Next.js module re-evaluations
const globalForSSE = globalThis as unknown as {
  __sse_user_clients__?: Map<string, Set<ClientController>>;
};

const userClients = globalForSSE.__sse_user_clients__ ?? new Map<string, Set<ClientController>>();

if (process.env.NODE_ENV !== 'production') {
  globalForSSE.__sse_user_clients__ = userClients;
}

export type RealTimeEventType =
  | 'NOTIFICATION'
  | 'TASK_CREATED'
  | 'TASK_UPDATED'
  | 'TASK_DELETED'
  | 'COMMENT_CREATED';

export interface BaseRealTimeEvent {
  type: RealTimeEventType;
  timestamp?: string;
  [key: string]: any;
}

/**
 * Registers an active streaming SSE client controller for a user.
 * Returns an unregister function to be called on connection abort or disconnect.
 */
export function registerClient(userId: string, controller: ClientController): () => void {
  let clientSet = userClients.get(userId);
  if (!clientSet) {
    clientSet = new Set();
    userClients.set(userId, clientSet);
  }
  clientSet.add(controller);

  return () => {
    const currentSet = userClients.get(userId);
    if (currentSet) {
      currentSet.delete(controller);
      if (currentSet.size === 0) {
        userClients.delete(userId);
      }
    }
  };
}

/**
 * Pushes any event or notification immediately to an individual user's active SSE streams.
 * Silently prunes any aborted or closed controllers.
 */
export function broadcastToUser(userId: string, payload: unknown): void {
  const clientSet = userClients.get(userId);
  if (!clientSet || clientSet.size === 0) return;

  const encoder = new TextEncoder();
  const sseChunk = encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

  const deadControllers: ClientController[] = [];

  for (const controller of clientSet) {
    try {
      controller.enqueue(sseChunk);
    } catch {
      deadControllers.push(controller);
    }
  }

  // Prune dead controllers
  if (deadControllers.length > 0) {
    for (const dead of deadControllers) {
      clientSet.delete(dead);
    }
    if (clientSet.size === 0) {
      userClients.delete(userId);
    }
  }
}

// Backward-compatible alias for notifications
export const broadcastNotification = broadcastToUser;

/**
 * Broadcasts an event to an array of specific user IDs (deduplicated).
 */
export function broadcastToUsers(userIds: string[], payload: unknown): void {
  const uniqueUsers = Array.from(new Set(userIds.filter(Boolean)));
  for (const uid of uniqueUsers) {
    broadcastToUser(uid, payload);
  }
}

/**
 * Broadcasts an event to all staff members assigned to a space,
 * plus any explicitly provided additional user IDs (e.g. ticket creator or assignee).
 */
export async function broadcastToSpaceStaff(
  spaceId: string,
  payload: unknown,
  additionalUserIds: string[] = []
): Promise<void> {
  try {
    const members = await prisma.spaceMember.findMany({
      where: { spaceId },
      select: { userId: true },
    });

    const targetUserIds = new Set<string>(members.map((m) => m.userId));
    for (const uid of additionalUserIds) {
      if (uid) targetUserIds.add(uid);
    }

    broadcastToUsers(Array.from(targetUserIds), payload);
  } catch (error) {
    console.error('Failed to broadcast to space staff:', error);
  }
}

/**
 * Returns the count of active listeners for a specific user or globally.
 */
export function getActiveSSEListenerCount(userId?: string): number {
  if (userId) {
    return userClients.get(userId)?.size ?? 0;
  }
  let total = 0;
  for (const set of userClients.values()) {
    total += set.size;
  }
  return total;
}
