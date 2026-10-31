import { NextRequest, NextResponse } from 'next/server';
import { SpaceRole } from '@prisma/client';
import { prisma } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { AuthenticatedUser } from '@/lib/security/rbac';
import { getStatusCategory } from '@/lib/status-utils';
import { broadcastToSpaceStaff } from '@/lib/sse-broker';
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

async function canUserManageStatuses(
  user: AuthenticatedUser,
  space: { id: string; departmentHeadId: string | null }
): Promise<boolean> {
  if (user.globalRole === 'SUPERADMIN') {
    return true;
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

  return Boolean(membership);
}

// PATCH /api/spaces/[id]/statuses/[statusId]
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; statusId: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user } = auth;
    const { id: spaceId, statusId } = await context.params;

    const space = await prisma.space.findUnique({
      where: { id: spaceId },
      select: { id: true, name: true, departmentHeadId: true },
    });

    if (!space) {
      return NextResponse.json({ error: 'Department space not found.' }, { status: 404 });
    }

    const authorized = await canUserManageStatuses(user, space);
    if (!authorized) {
      return NextResponse.json(
        { error: 'Forbidden: Superadmin or Department Admin clearance required to update status configurations.' },
        { status: 403 }
      );
    }

    const existingStatus = await prisma.taskStatus.findFirst({
      where: { id: statusId, spaceId },
    });

    if (!existingStatus) {
      return NextResponse.json({ error: 'Status not found in this department space.' }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Invalid or missing JSON payload.', code: 'INVALID_JSON' },
        { status: 400 }
      );
    }
    const { name, color, order } = body;

    const updateData: { name?: string; color?: string; order?: number } = {};

    if (name !== undefined) {
      const trimmedName = String(name).trim();
      if (!trimmedName) {
        return NextResponse.json({ error: 'Status name cannot be empty.' }, { status: 400 });
      }
      if (trimmedName.length > 50) {
        return NextResponse.json({ error: 'Status name cannot exceed 50 characters.' }, { status: 400 });
      }

      // Check duplicate name in space
      const duplicate = await prisma.taskStatus.findFirst({
        where: {
          spaceId,
          name: trimmedName,
          NOT: { id: statusId },
        },
      });

      if (duplicate) {
        return NextResponse.json(
          { error: `A status named "${trimmedName}" already exists in this department space.` },
          { status: 409 }
        );
      }

      updateData.name = trimmedName;
    }

    if (color !== undefined) {
      const trimmedColor = String(color).trim();
      if (trimmedColor) {
        updateData.color = trimmedColor;
      }
    }

    if (typeof order === 'number' && !isNaN(order)) {
      updateData.order = Math.max(0, Math.floor(order));
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid fields provided for update.' }, { status: 400 });
    }

    const updated = await prisma.taskStatus.update({
      where: { id: statusId },
      data: updateData,
      select: {
        id: true,
        spaceId: true,
        name: true,
        color: true,
        order: true,
        isCompleted: true,
        isClosed: true,
      },
    });

    const enriched = {
      ...updated,
      category: getStatusCategory(updated),
    };

    // Broadcast STATUS_UPDATED
    try {
      await broadcastToSpaceStaff(spaceId, {
        type: 'STATUS_UPDATED',
        spaceId,
        status: enriched,
      });
    } catch (e) {
      console.warn('Failed to broadcast status update event:', e);
    }

    invalidateCachePrefix('spaces:');
    invalidateCachePrefix('tasks:');

    return NextResponse.json({
      success: true,
      status: enriched,
    });
  } catch (error) {
    console.error('Failed to update status:', error);
    return NextResponse.json(
      { error: 'An unexpected internal error occurred while updating status.' },
      { status: 500 }
    );
  }
}
