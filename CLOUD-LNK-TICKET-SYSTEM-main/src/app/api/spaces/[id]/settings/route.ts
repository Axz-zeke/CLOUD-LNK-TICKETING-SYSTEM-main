import { NextRequest, NextResponse } from 'next/server';
import { SpaceRole } from '@prisma/client';
import { prisma } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { AuthenticatedUser } from '@/lib/security/rbac';
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

async function canManageSpaceSettings(
  user: AuthenticatedUser,
  space: { id: string; departmentHeadId: string | null }
): Promise<boolean> {
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

  return membership?.role === SpaceRole.ADMIN;
}

// GET /api/spaces/[id]/settings
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
    const { user } = auth;

    const space = await prisma.space.findUnique({
      where: { id },
      include: {
        departmentHead: {
          select: { id: true, name: true, username: true, email: true },
        },
        members: {
          include: {
            user: {
              select: { id: true, name: true, username: true, email: true, globalRole: true },
            },
          },
        },
      },
    });

    if (!space) {
      return NextResponse.json({ error: 'Department space not found.' }, { status: 404 });
    }

    const authorized = await canManageSpaceSettings(user, space);
    if (!authorized) {
      return NextResponse.json(
        { error: 'Forbidden: Department Settings are restricted strictly to Space Admins and Superadmins.' },
        { status: 403 }
      );
    }

    return NextResponse.json({ space });
  } catch (error) {
    console.error('Failed to get space settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/spaces/[id]/settings
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

    const space = await prisma.space.findUnique({
      where: { id },
      select: { id: true, departmentHeadId: true },
    });

    if (!space) {
      return NextResponse.json({ error: 'Department space not found.' }, { status: 404 });
    }

    const authorized = await canManageSpaceSettings(user, space);
    if (!authorized) {
      return NextResponse.json(
        { error: 'Forbidden: Department Settings mutations are restricted strictly to Space Admins and Superadmins.' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { name, description } = body;

    const updateData: Record<string, any> = {};
    if (name !== undefined) updateData.name = String(name).trim();
    if (description !== undefined) updateData.description = description ? String(description).trim() : null;

    const updatedSpace = await prisma.space.update({
      where: { id },
      data: updateData,
    });

    invalidateCachePrefix('spaces:');

    return NextResponse.json({ success: true, space: updatedSpace });
  } catch (error) {
    console.error('Failed to update space settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
