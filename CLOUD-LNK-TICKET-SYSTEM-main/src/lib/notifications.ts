import { prisma } from './db';
import crypto from 'node:crypto';
import { broadcastNotification } from './sse-broker';
import { invalidateCachePrefix } from './server-cache';

export interface NotificationRecord {
  id: string;
  userId: string;
  taskId?: string | null;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  task?: {
    id: string;
    taskKey: string;
    title: string;
  } | null;
}

/**
 * No-op table initializer.
 * All database schemas and indexes are managed by Prisma migrations / schema pushes.
 */
export async function ensureNotificationTable(): Promise<void> {
  // Managed by Prisma Client (Supabase PostgreSQL / SQLite)
}

/**
 * Dispatches an in-app notification to a user and broadcasts instantly via SSE.
 */
export async function createNotification(data: {
  userId: string;
  taskId?: string | null;
  title: string;
  message: string;
  taskSnippet?: { id: string; taskKey: string; title: string } | null;
}): Promise<NotificationRecord | null> {
  try {
    // Check user preferences if configured
    try {
      const userPref = await prisma.userPreference.findUnique({
        where: { userId: data.userId },
        select: { notifyOnAssign: true, notifyOnStatus: true },
      });

      if (userPref) {
        const lowerTitle = data.title.toLowerCase();
        const lowerMsg = data.message.toLowerCase();
        const isAssign = lowerTitle.includes('assigned') || lowerMsg.includes('assigned');
        const isStatus = lowerTitle.includes('status') || lowerMsg.includes('status');

        if (isAssign && !userPref.notifyOnAssign) {
          return null; // User disabled assignment alerts
        }
        if (isStatus && !userPref.notifyOnStatus) {
          return null; // User disabled status change alerts
        }
      }
    } catch {
      // Non-critical if preference query fails
    }

    const id = `notif_${crypto.randomUUID()}`;

    const created = await prisma.notification.create({
      data: {
        id,
        userId: data.userId,
        taskId: data.taskId || null,
        title: data.title,
        message: data.message,
        isRead: false,
      },
      include: {
        task: {
          select: { id: true, taskKey: true, title: true },
        },
      },
    });

    const record: NotificationRecord = {
      id: created.id,
      userId: created.userId,
      taskId: created.taskId,
      title: created.title,
      message: created.message,
      isRead: created.isRead,
      createdAt: created.createdAt.toISOString(),
      task: created.task || data.taskSnippet || null,
    };

    // Instantly push to connected SSE clients (<100ms)
    try {
      broadcastNotification(data.userId, record);
    } catch (sseErr) {
      console.error('Failed to broadcast SSE notification:', sseErr);
    }

    invalidateCachePrefix('notifications:user:');
    return record;
  } catch (error) {
    console.error('Error creating notification:', error);
    return null;
  }
}

/**
 * Efficiently batch-inserts notifications for multiple recipients.
 */
export async function createNotificationsBatch(
  items: Array<{
    userId: string;
    taskId?: string | null;
    title: string;
    message: string;
    taskSnippet?: { id: string; taskKey: string; title: string } | null;
  }>
): Promise<NotificationRecord[]> {
  if (items.length === 0) return [];

  try {
    const now = new Date();
    const dataToInsert = items.map((item) => ({
      id: `notif_${crypto.randomUUID()}`,
      userId: item.userId,
      taskId: item.taskId || null,
      title: item.title,
      message: item.message,
      isRead: false,
      createdAt: now,
    }));

    await prisma.notification.createMany({
      data: dataToInsert,
    });

    const records: NotificationRecord[] = dataToInsert.map((rec, idx) => ({
      id: rec.id,
      userId: rec.userId,
      taskId: rec.taskId,
      title: rec.title,
      message: rec.message,
      isRead: false,
      createdAt: now.toISOString(),
      task: items[idx].taskSnippet || null,
    }));

    // Push to connected SSE clients
    for (const rec of records) {
      try {
        broadcastNotification(rec.userId, rec);
      } catch {
        // SSE failure is non-fatal
      }
    }

    invalidateCachePrefix('notifications:user:');
    return records;
  } catch (error) {
    console.error('Error creating batch notifications:', error);
    return [];
  }
}

/**
 * Retrieves notifications for a given user, newest first.
 * Executes in a single fast, indexed query.
 */
export async function getUserNotifications(
  userId: string,
  limit = 40
): Promise<NotificationRecord[]> {
  try {
    const rows = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        task: {
          select: { id: true, taskKey: true, title: true },
        },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      taskId: r.taskId,
      title: r.title,
      message: r.message,
      isRead: r.isRead,
      createdAt: r.createdAt.toISOString(),
      task: r.task,
    }));
  } catch (error) {
    console.error('Error fetching notifications:', error);
    return [];
  }
}

/**
 * Returns the count of unread notifications for a user.
 */
export async function getUnreadNotificationCount(userId: string): Promise<number> {
  try {
    return await prisma.notification.count({
      where: {
        userId,
        isRead: false,
      },
    });
  } catch (error) {
    console.error('Error fetching unread notification count:', error);
    return 0;
  }
}

/**
 * Marks a single notification as read.
 */
export async function markNotificationAsRead(id: string, userId: string): Promise<boolean> {
  try {
    await prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });
    invalidateCachePrefix('notifications:user:');
    return true;
  } catch (error) {
    console.error('Error marking notification as read:', error);
    return false;
  }
}

/**
 * Marks all notifications for a user as read.
 */
export async function markAllNotificationsAsRead(userId: string): Promise<boolean> {
  try {
    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    invalidateCachePrefix('notifications:user:');
    return true;
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    return false;
  }
}

/**
 * Dispatches notifications to all staff members assigned to a space.
 */
export async function notifySpaceMembers(options: {
  spaceId: string;
  excludeUserIds?: string[];
  taskId?: string;
  title: string;
  message: string;
}): Promise<void> {
  try {
    const { spaceId, excludeUserIds = [], taskId, title, message } = options;
    const members = await prisma.spaceMember.findMany({
      where: {
        spaceId,
        userId: { notIn: excludeUserIds },
      },
      select: { userId: true },
    });

    if (members.length === 0) return;

    await createNotificationsBatch(
      members.map((m) => ({
        userId: m.userId,
        taskId,
        title,
        message,
      }))
    );
  } catch (error) {
    console.error('Error notifying space members:', error);
  }
}

/**
 * Deletes all read notifications for a user to keep the list clean.
 */
export async function clearReadNotifications(userId: string): Promise<boolean> {
  try {
    await prisma.notification.deleteMany({
      where: { userId, isRead: true },
    });
    invalidateCachePrefix('notifications:user:');
    return true;
  } catch (error) {
    console.error('Error clearing read notifications:', error);
    return false;
  }
}
