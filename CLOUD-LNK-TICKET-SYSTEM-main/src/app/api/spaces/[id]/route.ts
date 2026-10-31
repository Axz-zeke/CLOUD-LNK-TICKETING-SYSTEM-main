import { NextRequest, NextResponse } from 'next/server';
import { prisma, withDbRetry, DB_TRANSACTION_OPTIONS } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { invalidateCachePrefix } from '@/lib/server-cache';
import { getStatusCategory } from '@/lib/status-utils';

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

// GET /api/spaces/[id] - Retrieve single Space details
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id } = await context.params;

    const space = await prisma.space.findUnique({
      where: { id },
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
            _count: { select: { tasks: true } },
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
        _count: {
          select: { tasks: true, members: true },
        },
      },
    });

    if (!space) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    }

    let desc = space.description;
    let color = '#3B82F6';
    let icon = 'Building';
    if (space.description && space.description.startsWith('{')) {
      try {
        const parsed = JSON.parse(space.description);
        if (parsed && typeof parsed === 'object') {
          desc = parsed.text ?? null;
          color = parsed.color || color;
          icon = parsed.icon || icon;
        }
      } catch {}
    }

    const formattedSpace = {
      ...space,
      statuses: space.statuses.map((st) => ({
        ...st,
        category: getStatusCategory(st),
      })),
      description: desc,
      color,
      icon,
    };

    return NextResponse.json({ success: true, space: formattedSpace });
  } catch (error) {
    console.error('Failed to get space:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/spaces/[id] - Update space details
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id } = await context.params;
    const { user } = auth;

    if (user.globalRole !== 'SUPERADMIN') {
      return NextResponse.json(
        { error: 'Forbidden: Superadmin clearance required.' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { name, description, color, icon } = body;

    const existingSpace = await prisma.space.findUnique({
      where: { id },
      select: { id: true, description: true },
    });

    if (!existingSpace) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    }

    let currentMeta: Record<string, any> = { color: '#3B82F6', icon: 'Building', text: null };
    if (existingSpace.description && existingSpace.description.startsWith('{')) {
      try {
        currentMeta = JSON.parse(existingSpace.description);
      } catch {}
    }

    if (description !== undefined) currentMeta.text = description ? String(description).trim() : null;
    if (color !== undefined) currentMeta.color = String(color);
    if (icon !== undefined) currentMeta.icon = String(icon);

    const updateData: Record<string, any> = {
      description: JSON.stringify(currentMeta),
    };
    if (name) {
      updateData.name = String(name).trim();
      updateData.slug = updateData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    }

    const updatedSpace = await prisma.space.update({
      where: { id },
      data: updateData,
    });

    invalidateCachePrefix('spaces:');
    invalidateCachePrefix('admin:');

    return NextResponse.json({ success: true, space: updatedSpace });
  } catch (error) {
    console.error('Failed to update space:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/spaces/[id] - Delete department space with complete cascade & cache purge
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id } = await context.params;
    const { user } = auth;

    if (user.globalRole !== 'SUPERADMIN') {
      return NextResponse.json(
        { error: 'Forbidden: Superadmin clearance required to delete spaces.' },
        { status: 403 }
      );
    }

    const space = await prisma.space.findUnique({
      where: { id },
      include: {
        _count: { select: { tasks: true, lists: true, members: true } },
      },
    });

    if (!space) {
      return NextResponse.json(
        { error: 'NOT_FOUND', message: 'Department space not found.' },
        { status: 404 }
      );
    }

    const totalSpaces = await prisma.space.count({
      where: { workspaceId: space.workspaceId },
    });
    if (totalSpaces <= 1) {
      return NextResponse.json(
        {
          error: 'CANNOT_DELETE_LAST_SPACE',
          message: 'Cannot delete the only remaining department space in the organization.',
        },
        { status: 400 }
      );
    }

    // 1. Gather all tasks in this space
    const tasks = await prisma.task.findMany({
      where: { spaceId: id },
      select: { id: true },
    });
    const taskIds = tasks.map((t) => t.id);

    // 2. Cascading deletion
    await withDbRetry(() =>
      prisma.$transaction(async (tx) => {
        if (taskIds.length > 0) {
          await tx.notification.deleteMany({ where: { taskId: { in: taskIds } } });
          await tx.taskHistory.deleteMany({ where: { taskId: { in: taskIds } } });
          await tx.taskChecklistItem.deleteMany({ where: { taskId: { in: taskIds } } });
          await tx.taskComment.deleteMany({ where: { taskId: { in: taskIds } } });
          await tx.attachment.deleteMany({ where: { taskId: { in: taskIds } } });
          await tx.task.deleteMany({ where: { spaceId: id } });
        }

        await tx.list.deleteMany({ where: { spaceId: id } });
        await tx.taskStatus.deleteMany({ where: { spaceId: id } });
        await tx.slaPolicy.deleteMany({ where: { spaceId: id } });
        await tx.spaceMember.deleteMany({ where: { spaceId: id } });

        await tx.space.delete({ where: { id } });
      }, DB_TRANSACTION_OPTIONS)
    );

    // 3. Purge all related server caches across spaces, tasks, admin, rbac, and sessions
    invalidateCachePrefix('spaces:');
    invalidateCachePrefix('tasks:');
    invalidateCachePrefix('admin:');
    invalidateCachePrefix('clearance:');
    invalidateCachePrefix('rbac:');
    invalidateCachePrefix('user:spaces:');
    invalidateCachePrefix('auth:session:');

    // 4. Background audit log
    void prisma.auditLog
      .create({
        data: {
          event: 'SPACE_DELETED',
          userId: user.id,
          resourceType: 'Space',
          resourceId: id,
          details: JSON.stringify({
            deletedSpaceName: space.name,
            deletedSpaceKey: space.key,
            actor: user.username,
          }),
        },
      })
      .catch(() => {});

    return NextResponse.json({
      success: true,
      message: `Department space '${space.name}' (${space.key}) successfully deleted.`,
    });
  } catch (error) {
    console.error('Failed to delete space:', error);
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 }
    );
  }
}
