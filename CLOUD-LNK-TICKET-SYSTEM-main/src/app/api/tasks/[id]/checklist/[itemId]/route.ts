import { NextRequest, NextResponse } from 'next/server';
import { prisma, withDbRetry } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { assertTaskAccess } from '@/lib/security/query-guard';
import { ForbiddenError } from '@/lib/security/rbac';
import { invalidateCachePrefix } from '@/lib/server-cache';

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

// PATCH /api/tasks/[id]/checklist/[itemId]
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id: taskId, itemId } = await context.params;
    const { user } = auth;
    const ipAddress = request.headers.get('x-forwarded-for') || '127.0.0.1';

    const task = await assertTaskAccess(taskId, user, { ipAddress, db: prisma });

    const existingItem = await prisma.taskChecklistItem.findFirst({
      where: { id: itemId, taskId },
    });

    if (!existingItem) {
      return NextResponse.json({ error: 'Checklist item not found.' }, { status: 404 });
    }

    const body = await request.json();
    const { isCompleted, title, order } = body;

    const dataToUpdate: any = {};
    let historyNote = '';

    if (typeof isCompleted === 'boolean') {
      dataToUpdate.isCompleted = isCompleted;
      if (isCompleted) {
        dataToUpdate.completedById = user.id;
        dataToUpdate.completedAt = new Date();
        historyNote = `Completed subtask: "${existingItem.title}"`;
      } else {
        dataToUpdate.completedById = null;
        dataToUpdate.completedAt = null;
        historyNote = `Reopened subtask: "${existingItem.title}"`;
      }
    }

    if (typeof title === 'string' && title.trim()) {
      dataToUpdate.title = title.trim();
      historyNote = `Renamed subtask to "${dataToUpdate.title}"`;
    }

    if (typeof order === 'number') {
      dataToUpdate.order = order;
    }

    const updatedItem = await withDbRetry(async () => {
      return prisma.taskChecklistItem.update({
        where: { id: itemId },
        data: dataToUpdate,
      });
    });

    if (historyNote) {
      void prisma.taskHistory.create({
        data: {
          taskId,
          actorId: user.id,
          actionType: typeof isCompleted === 'boolean' ? 'CHECKLIST_TOGGLE' : 'CHECKLIST_UPDATE',
          fromSpaceId: task.spaceId,
          toSpaceId: task.spaceId,
          notes: historyNote,
        },
      }).catch((histErr) => console.warn('[History] Failed to record CHECKLIST update:', histErr));
    }

    invalidateCachePrefix('tasks:');
    invalidateCachePrefix(`task:detail:${taskId}`);
    return NextResponse.json({ item: updatedItem });
  } catch (error: any) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error?.message || 'Failed to update checklist item.' },
      { status: error?.status || 500 }
    );
  }
}

// DELETE /api/tasks/[id]/checklist/[itemId]
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id: taskId, itemId } = await context.params;
    const { user } = auth;
    const ipAddress = request.headers.get('x-forwarded-for') || '127.0.0.1';

    const task = await assertTaskAccess(taskId, user, { ipAddress, db: prisma });

    const existingItem = await prisma.taskChecklistItem.findFirst({
      where: { id: itemId, taskId },
    });

    if (!existingItem) {
      return NextResponse.json({ error: 'Checklist item not found.' }, { status: 404 });
    }

    await withDbRetry(async () => {
      return prisma.taskChecklistItem.delete({
        where: { id: itemId },
      });
    });

    void prisma.taskHistory.create({
      data: {
        taskId,
        actorId: user.id,
        actionType: 'CHECKLIST_DELETE',
        fromSpaceId: task.spaceId,
        toSpaceId: task.spaceId,
        notes: `Deleted subtask: "${existingItem.title}"`,
      },
    }).catch((histErr) => console.warn('[History] Failed to record CHECKLIST_DELETE:', histErr));

    invalidateCachePrefix('tasks:');
    invalidateCachePrefix(`task:detail:${taskId}`);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error?.message || 'Failed to delete checklist item.' },
      { status: error?.status || 500 }
    );
  }
}
