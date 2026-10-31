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

// GET /api/tasks/[id]/checklist
export async function GET(
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

    await assertTaskAccess(taskId, user, { ipAddress, db: prisma });

    const items = await prisma.taskChecklistItem.findMany({
      where: { taskId },
      orderBy: { order: 'asc' },
    });

    return NextResponse.json({ items });
  } catch (error: any) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch checklist items.' },
      { status: error?.status || 500 }
    );
  }
}

// POST /api/tasks/[id]/checklist
export async function POST(
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

    const task = await assertTaskAccess(taskId, user, { ipAddress, db: prisma });

    const body = await request.json();
    const { title, items } = body;

    const lastItem = await prisma.taskChecklistItem.findFirst({
      where: { taskId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    let nextOrder = (lastItem?.order ?? -1) + 1;

    if (Array.isArray(items) && items.length > 0) {
      const cleanTitles = items
        .map((t) => String(t).trim())
        .filter((t) => t.length > 0);

      const createdItems = await withDbRetry(async () => {
        return prisma.$transaction(
          cleanTitles.map((cleanTitle, idx) =>
            prisma.taskChecklistItem.create({
              data: {
                taskId,
                title: cleanTitle,
                order: nextOrder + idx,
              },
            })
          )
        );
      });

      if (createdItems.length > 0) {
        void prisma.taskHistory.create({
          data: {
            taskId,
            actorId: user.id,
            actionType: 'CHECKLIST_ADD',
            fromSpaceId: task.spaceId,
            toSpaceId: task.spaceId,
            notes: `Added ${createdItems.length} checklist subtasks`,
          },
        }).catch((histErr) => console.warn('[History] Failed to record CHECKLIST_ADD:', histErr));
      }

      invalidateCachePrefix('tasks:');
      invalidateCachePrefix(`task:detail:${taskId}`);
      return NextResponse.json({ items: createdItems }, { status: 201 });
    }

    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) {
      return NextResponse.json({ error: 'Checklist title is required.' }, { status: 400 });
    }

    const createdItem = await withDbRetry(async () => {
      return prisma.taskChecklistItem.create({
        data: {
          taskId,
          title: cleanTitle,
          order: nextOrder,
        },
      });
    });

    void prisma.taskHistory.create({
      data: {
        taskId,
        actorId: user.id,
        actionType: 'CHECKLIST_ADD',
        fromSpaceId: task.spaceId,
        toSpaceId: task.spaceId,
        notes: `Added checklist subtask: ${cleanTitle}`,
      },
    }).catch((histErr) => console.warn('[History] Failed to record CHECKLIST_ADD:', histErr));

    invalidateCachePrefix('tasks:');
    invalidateCachePrefix(`task:detail:${taskId}`);
    return NextResponse.json({ item: createdItem }, { status: 201 });
  } catch (error: any) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error?.message || 'Failed to create checklist item.' },
      { status: error?.status || 500 }
    );
  }
}
