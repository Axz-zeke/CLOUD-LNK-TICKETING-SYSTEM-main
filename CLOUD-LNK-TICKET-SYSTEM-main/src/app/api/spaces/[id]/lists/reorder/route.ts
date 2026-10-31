import { NextRequest, NextResponse } from 'next/server';
import { SpaceRole } from '@prisma/client';
import { prisma, withDbRetry } from '@/lib/db';
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

// PATCH & PUT /api/spaces/[id]/lists/reorder - Reorder queue lists for a Space
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id?: string; spaceId?: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const params = await context.params;
    const spaceId = params.id || params.spaceId;

    if (!spaceId) {
      return NextResponse.json({ error: 'Space ID is required.' }, { status: 400 });
    }

    const space = await prisma.space.findUnique({
      where: { id: spaceId },
      select: { id: true, name: true, departmentHeadId: true },
    });

    if (!space) {
      return NextResponse.json({ error: 'Department space not found.' }, { status: 404 });
    }

    const isAuthorized = await canUserManageLists(auth.user, space);
    if (!isAuthorized) {
      return NextResponse.json(
        {
          error:
            'Forbidden: Only Superadmins and designated Department Heads/Admins can manage queue lists for this space.',
        },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { listIds } = body;

    if (!Array.isArray(listIds) || listIds.length === 0) {
      return NextResponse.json(
        { error: 'Invalid payload: listIds must be a non-empty array of list IDs.' },
        { status: 400 }
      );
    }

    // Verify all listIds belong to this space
    const existingLists = await prisma.list.findMany({
      where: {
        id: { in: listIds },
        spaceId,
      },
      select: { id: true },
    });

    if (existingLists.length !== listIds.length) {
      return NextResponse.json(
        { error: 'One or more list IDs are invalid or do not belong to this space.' },
        { status: 400 }
      );
    }

    // Update each list's order within an atomic Prisma transaction with lock retry guard
    await withDbRetry(() =>
      prisma.$transaction(
        listIds.map((id, index) =>
          prisma.list.update({
            where: { id },
            data: { order: index },
          })
        )
      )
    );

    // Fetch and return the updated lists in new order
    const updatedLists = await prisma.list.findMany({
      where: { spaceId },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        spaceId: true,
        name: true,
        description: true,
        color: true,
        order: true,
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

    return NextResponse.json({
      success: true,
      message: 'Queue lists reordered successfully.',
      lists: updatedLists,
    });
  } catch (error) {
    console.error('Failed to reorder queue lists:', error);
    return NextResponse.json(
      { error: 'An unexpected internal error occurred while reordering queue lists.' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id?: string; spaceId?: string }> }
) {
  return PATCH(request, context);
}
