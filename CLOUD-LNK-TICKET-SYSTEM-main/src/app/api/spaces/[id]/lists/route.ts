import { NextRequest, NextResponse } from 'next/server';
import { SpaceRole } from '@prisma/client';
import { prisma } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { AuthenticatedUser } from '@/lib/security/rbac';
import { OPEN_ONLY_TASK_STATUS_FILTER } from '@/lib/status-utils';
import { invalidateCachePrefix, peekCache, setCache } from '@/lib/server-cache';

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

/**
 * Helper to verify if user has authority to manage queue lists for a specific space.
 * - SUPERADMIN: Unrestricted access across all spaces.
 * - ADMIN: Must be the designated Department Head or an assigned Space Admin.
 * - EMPLOYEE: Read-only; cannot mutate.
 */
async function canUserManageLists(user: AuthenticatedUser, space: { id: string; departmentHeadId: string | null }) {
  if (user.globalRole === 'SUPERADMIN') {
    return true;
  }

  if (user.globalRole !== 'ADMIN') {
    return false;
  }

  // Check if user is the assigned department head
  if (space.departmentHeadId === user.id) {
    return true;
  }

  // Check if user is a member with ADMIN role or assigned member of space
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

// GET /api/spaces/[id]/lists - Returns all Queue Lists for a Space ordered by order ASC
export async function GET(
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
      select: { id: true, name: true, key: true, departmentHeadId: true },
    });

    if (!space) {
      return NextResponse.json({ error: 'Department space not found.' }, { status: 404 });
    }

    const { user } = auth;
    let canViewPrivate = false;
    if (user.globalRole === 'SUPERADMIN') {
      canViewPrivate = true;
    } else if (space.departmentHeadId === user.id) {
      canViewPrivate = true;
    } else {
      const membership = await prisma.spaceMember.findUnique({
        where: {
          spaceId_userId: {
            spaceId,
            userId: user.id,
          },
        },
        select: { id: true },
      });
      canViewPrivate = Boolean(membership);
    }

    const whereClause: Record<string, any> = { spaceId };
    if (!canViewPrivate) {
      whereClause.isPrivate = false;
    }

    const lists = await prisma.list.findMany({
      where: whereClause,
      orderBy: { order: 'asc' },
      select: {
        id: true,
        spaceId: true,
        name: true,
        description: true,
        color: true,
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

    return NextResponse.json({
      success: true,
      space,
      lists,
    });
  } catch (error) {
    console.error('Failed to fetch space lists:', error);
    return NextResponse.json(
      { error: 'An unexpected internal error occurred while fetching queue lists.' },
      { status: 500 }
    );
  }
}

// POST /api/spaces/[id]/lists - Create a new Queue List under a Space
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id?: string; spaceId?: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user } = auth;
    const params = await context.params;
    const spaceId = params.id || params.spaceId;

    if (!spaceId) {
      return NextResponse.json({ error: 'Space ID is required.' }, { status: 400 });
    }

    // 1. Resolve Space and validate permissions using in-memory cache or DB
    const masterSpaces = peekCache<any[]>('spaces:master');
    let space = masterSpaces?.find((s) => s.id === spaceId);

    if (!space) {
      space = await prisma.space.findUnique({
        where: { id: spaceId },
        select: {
          id: true,
          name: true,
          key: true,
          departmentHeadId: true,
          members: { select: { userId: true, role: true } },
          lists: { orderBy: { order: 'asc' }, select: { id: true, name: true, order: true } },
        },
      });
    }

    if (!space) {
      return NextResponse.json({ error: 'Department space not found.' }, { status: 404 });
    }

    // Strict RBAC Enforcement: EMPLOYEE cannot mutate, ADMIN must be assigned to space, SUPERADMIN unrestricted
    let authorized = user.globalRole === 'SUPERADMIN' || space.departmentHeadId === user.id;
    if (!authorized) {
      if (space.members && Array.isArray(space.members)) {
        authorized = space.members.some((m: any) => m.userId === user.id);
      } else {
        authorized = await canUserManageLists(user, space);
      }
    }

    if (!authorized) {
      return NextResponse.json(
        {
          error:
            'Forbidden: Only authorized Department Heads or Superadmins can add Queue Lists to this department.',
        },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { name, color, description, order, isPrivate } = body;

    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) {
      return NextResponse.json(
        { error: 'Queue list name is required and cannot be empty.' },
        { status: 400 }
      );
    }

    if (trimmedName.length > 60) {
      return NextResponse.json(
        { error: 'Queue list name cannot exceed 60 characters.' },
        { status: 400 }
      );
    }

    // Check for duplicate names inside the same department space
    const isDuplicate = space.lists?.some(
      (l: any) => l.name?.toLowerCase() === trimmedName.toLowerCase()
    );

    if (isDuplicate) {
      return NextResponse.json(
        { error: `A queue list named '${trimmedName}' already exists in this space.` },
        { status: 409 }
      );
    }

    // Auto-calculate next order index: (maxCurrentOrder ?? -1) + 1
    let listOrder = typeof order === 'number' ? order : undefined;
    if (listOrder === undefined) {
      if (space.lists && space.lists.length > 0) {
        const maxOrder = Math.max(...space.lists.map((l: any) => l.order ?? 0));
        listOrder = maxOrder + 1;
      } else {
        listOrder = 0;
      }
    }

    const trimmedColor =
      typeof color === 'string' && color.trim().length > 0 ? color.trim() : null;
    const trimmedDesc =
      typeof description === 'string' && description.trim().length > 0
        ? description.trim()
        : null;

    // Single DB write query
    const newList = await prisma.list.create({
      data: {
        spaceId,
        name: trimmedName,
        color: trimmedColor,
        description: trimmedDesc,
        order: listOrder,
        isPrivate: typeof isPrivate === 'boolean' ? isPrivate : false,
      },
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

    // In-place update of in-memory 'spaces:master' cache
    if (masterSpaces && Array.isArray(masterSpaces)) {
      const spaceIdx = masterSpaces.findIndex((s) => s.id === spaceId);
      if (spaceIdx !== -1) {
        const target = masterSpaces[spaceIdx];
        target.lists = [...(target.lists || []), newList];
        setCache('spaces:master', masterSpaces, 120_000);
      }
    }
    invalidateCachePrefix('spaces:user:');

    return NextResponse.json(
      {
        success: true,
        list: newList,
        message: `Queue list '${newList.name}' created successfully.`,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Failed to create queue list:', error);
    if (error?.code === 'P2002') {
      return NextResponse.json(
        { error: 'A queue list with this name already exists in this space.' },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: 'An unexpected internal error occurred while creating the queue list.' },
      { status: 500 }
    );
  }
}
