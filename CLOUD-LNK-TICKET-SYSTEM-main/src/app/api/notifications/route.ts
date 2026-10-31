import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import {
  getUserNotifications,
  getUnreadNotificationCount,
  markAllNotificationsAsRead,
  clearReadNotifications,
} from '@/lib/notifications';
import { getOrSetCache, invalidateCachePrefix } from '@/lib/server-cache';

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

// GET /api/notifications - List active notifications for the current user (cached 15s with 60s SWR)
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user } = auth;
    const { searchParams } = request.nextUrl;
    const isDelta = searchParams.get('delta') === '1';

    // Fast-path for background delta sync heartbeats (< 50ms): single parallel query without full notifications array or joins
    if (isDelta) {
      const [latestNotif, unreadCount, agg] = await Promise.all([
        prisma.notification.findFirst({
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
          select: { id: true, createdAt: true },
        }),
        prisma.notification.count({
          where: { userId: user.id, isRead: false },
        }),
        prisma.task.aggregate({
          _max: { updatedAt: true },
          _count: { _all: true },
        }),
      ]);

      const latestTaskUpdatedAt = agg._max.updatedAt ? agg._max.updatedAt.toISOString() : null;
      const totalTaskCount = agg._count._all;
      const latestNotificationId = latestNotif?.id ?? null;

      return NextResponse.json({
        notifications: [],
        unreadCount,
        latestNotificationId,
        latestTaskUpdatedAt,
        totalTaskCount,
      });
    }

    const forceFresh =
      searchParams.get('fresh') === '1' ||
      Boolean(searchParams.get('_t'));
    const cacheKey = `notifications:user:${user.id}`;

    const data = await getOrSetCache(
      cacheKey,
      15_000, // 15 seconds fresh TTL
      async () => {
        const [notifications, unreadCount] = await Promise.all([
          getUserNotifications(user.id),
          getUnreadNotificationCount(user.id),
        ]);
        return { notifications, unreadCount };
      },
      { swrMs: 60_000, forceFresh } // 60 seconds stale-while-revalidate window
    );

    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to get notifications:', error);
    return NextResponse.json(
      { error: 'An unexpected internal error occurred while fetching notifications.' },
      { status: 500 }
    );
  }
}

// POST /api/notifications/read-all - Mark all notifications as read for current user
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user } = auth;
    await markAllNotificationsAsRead(user.id);
    invalidateCachePrefix('notifications:user:');

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to mark all notifications as read:', error);
    return NextResponse.json(
      { error: 'An unexpected internal error occurred.' },
      { status: 500 }
    );
  }
}

// DELETE /api/notifications - Delete all read notifications for current user
export async function DELETE(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user } = auth;
    await clearReadNotifications(user.id);
    invalidateCachePrefix('notifications:user:');

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to clear read notifications:', error);
    return NextResponse.json(
      { error: 'An unexpected internal error occurred while clearing read notifications.' },
      { status: 500 }
    );
  }
}
