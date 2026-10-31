import { NextRequest, NextResponse } from 'next/server';
import { SpaceRole } from '@prisma/client';
import { prisma } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { AuthenticatedUser } from '@/lib/security/rbac';
import { OPEN_ONLY_TASK_STATUS_FILTER } from '@/lib/status-utils';
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

async function canUserManageLists(
  user: AuthenticatedUser,
  space: { id: string; departmentHeadId: string | null }
) {
  if (user.globalRole === 'SUPERADMIN') {
    return true;
  }

  if (user.globalRole !== 'ADMIN') {
    return false;
  }

  if (space.departmentHeadId === user.id) {
    return true;
  }

  const membership = await prisma.spaceMember.findUnique({
    where: {
      spaceId_userId: {
        spaceId: space.id,
        userId: user.id,
      },
    },
    select: { role: true },
  });

  return membership?.role === SpaceRole.ADMIN || Boolean(membership);
}

// DELETE /api/spaces/[id]/lists/[listId] - Safely delete a Queue List
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id?: string; spaceId?: string; listId: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user } = auth;
    const params = await context.params;
    const spaceId = params.id || params.spaceId;
    const { listId } = params;

    if (!spaceId || !listId) {
      return NextResponse.json(
        { error: 'Both Space ID and List ID are required.' },
        { status: 400 }
      );
    }

    // Verify Space exists
    const space = await prisma.space.findUnique({
      where: { id: spaceId },
      select: { id: true, name: true, departmentHeadId: true },
    });

    if (!space) {
      return NextResponse.json({ error: 'Department space not found.' }, { status: 404 });
    }

    // Strict RBAC Enforcement
    const authorized = await canUserManageLists(user, space);
    if (!authorized) {
      return NextResponse.json(
        {
          error:
            'Forbidden: Only authorized Department Heads or Superadmins can delete Queue Lists in this space.',
        },
        { status: 403 }
      );
    }

    // Verify List exists and belongs to this Space
    const targetList = await prisma.list.findUnique({
      where: { id: listId },
      select: {
        id: true,
        spaceId: true,
        name: true,
      },
    });

    if (!targetList || targetList.spaceId !== spaceId) {
      return NextResponse.json(
        { error: 'Queue list not found in this department space.' },
        { status: 404 }
      );
    }

    // Safe Deletion Check: Count tickets assigned to this list
    const ticketCount = await prisma.task.count({
      where: { listId },
    });

    if (ticketCount > 0) {
      return NextResponse.json(
        {
          error: 'LIST_NOT_EMPTY',
          message: `Cannot delete list '${targetList.name}' containing ${ticketCount} active tickets. Reassign or resolve these tickets before deleting.`,
          ticketCount,
        },
        { status: 400 }
      );
    }

    await prisma.list.delete({
      where: { id: listId },
    });

    invalidateCachePrefix('spaces:');
    invalidateCachePrefix('tasks:');

    return NextResponse.json({
      success: true,
      deletedListId: listId,
      message: `Queue list '${targetList.name}' deleted successfully.`,
    });
  } catch (error) {
    console.error('Failed to delete queue list:', error);
    return NextResponse.json(
      { error: 'An unexpected internal error occurred while deleting the queue list.' },
      { status: 500 }
    );
  }
}

// PATCH /api/spaces/[id]/lists/[listId] - Update Queue List (rename, color, order)
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id?: string; spaceId?: string; listId: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user } = auth;
    const params = await context.params;
    const spaceId = params.id || params.spaceId;
    const { listId } = params;

    if (!spaceId || !listId) {
      return NextResponse.json(
        { error: 'Both Space ID and List ID are required.' },
        { status: 400 }
      );
    }

    const space = await prisma.space.findUnique({
      where: { id: spaceId },
      select: { id: true, name: true, departmentHeadId: true },
    });

    if (!space) {
      return NextResponse.json({ error: 'Department space not found.' }, { status: 404 });
    }

    const authorized = await canUserManageLists(user, space);
    if (!authorized) {
      return NextResponse.json(
        {
          error:
            'Forbidden: Only authorized Department Heads or Superadmins can edit Queue Lists.',
        },
        { status: 403 }
      );
    }

    const targetList = await prisma.list.findUnique({
      where: { id: listId },
    });

    if (!targetList || targetList.spaceId !== spaceId) {
      return NextResponse.json(
        { error: 'Queue list not found in this department space.' },
        { status: 404 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { name, color, description, order, isPrivate } = body;

    const updateData: Record<string, any> = {};

    if (isPrivate !== undefined) {
      updateData.isPrivate = Boolean(isPrivate);
    }

    if (name !== undefined) {
      const trimmedName = String(name).trim();
      if (!trimmedName) {
        return NextResponse.json(
          { error: 'Queue list name cannot be empty.' },
          { status: 400 }
        );
      }
      if (trimmedName !== targetList.name) {
        // Check uniqueness in same space
        const existing = await prisma.list.findFirst({
          where: {
            spaceId,
            name: { equals: trimmedName },
            id: { not: listId },
          },
        });
        if (existing) {
          return NextResponse.json(
            { error: `Another list named '${trimmedName}' already exists in this space.` },
            { status: 409 }
          );
        }
        updateData.name = trimmedName;
      }
    }

    if (color !== undefined) {
      updateData.color = typeof color === 'string' && color.trim().length > 0 ? color.trim() : null;
    }

    if (description !== undefined) {
      updateData.description =
        typeof description === 'string' && description.trim().length > 0
          ? description.trim()
          : null;
    }

    if (order !== undefined && typeof order === 'number') {
      updateData.order = order;
    }

    const updated = await prisma.list.update({
      where: { id: listId },
      data: updateData,
      select: {
        id: true,
        spaceId: true,
        name: true,
        color: true,
        description: true,
        order: true,
        isPrivate: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            tasks: {
              where: OPEN_ONLY_TASK_STATUS_FILTER,
            },
          },
        },
      },
    });

    invalidateCachePrefix('spaces:');
    invalidateCachePrefix('tasks:');

    return NextResponse.json({
      success: true,
      list: updated,
      message: 'Queue list updated successfully.',
    });
  } catch (error: any) {
    console.error('Failed to update queue list:', error);
    if (error?.code === 'P2002') {
      return NextResponse.json(
        { error: 'A queue list with this name already exists in this space.' },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: 'An unexpected internal error occurred while updating the queue list.' },
      { status: 500 }
    );
  }
}
