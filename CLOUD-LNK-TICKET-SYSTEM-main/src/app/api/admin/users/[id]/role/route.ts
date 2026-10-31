import { NextRequest, NextResponse } from 'next/server';
import { GlobalRole } from '@prisma/client';
import { prisma } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';

async function getAuthenticatedSuperadmin(request: NextRequest) {
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

  if (sessionData.user.globalRole !== 'SUPERADMIN') {
    return {
      error: 'Forbidden: Superadmin clearance required to promote or demote user roles.',
      status: 403,
    };
  }

  return { user: sessionData.user };
}

// PATCH /api/admin/users/[id]/role - Promote or demote user global role
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedSuperadmin(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const requestedRole = (body.globalRole || body.role) as GlobalRole;

    if (!requestedRole || !['SUPERADMIN', 'ADMIN', 'EMPLOYEE'].includes(requestedRole)) {
      return NextResponse.json(
        { error: 'Invalid role specified. Role must be SUPERADMIN, ADMIN, or EMPLOYEE.' },
        { status: 400 }
      );
    }

    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        globalRole: true,
        isActive: true,
      },
    });

    if (!targetUser) {
      return NextResponse.json({ error: 'Target user not found.' }, { status: 404 });
    }

    const oldRole = targetUser.globalRole;

    // Protection rule: If demoting a SUPERADMIN to something else
    if (oldRole === 'SUPERADMIN' && requestedRole !== 'SUPERADMIN') {
      const activeSuperadminCount = await prisma.user.count({
        where: {
          globalRole: 'SUPERADMIN',
          isActive: true,
        },
      });

      if (activeSuperadminCount <= 1) {
        return NextResponse.json(
          {
            error:
              'Cannot demote the sole remaining active Superadmin in the system. Another Superadmin must be designated first.',
          },
          { status: 400 }
        );
      }
    }

    // If role has not changed, return success directly
    if (oldRole === requestedRole) {
      return NextResponse.json({
        success: true,
        user: targetUser,
        message: 'User already holds the requested role.',
      });
    }

    // Direct update and background async audit logging (zero transaction timeout risk)
    const actorName = auth.user.name || auth.user.username;
    const targetName = targetUser.name || targetUser.username;

    const updatedUser = await prisma.user.update({
      where: { id },
      data: { globalRole: requestedRole },
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        globalRole: true,
        isActive: true,
        updatedAt: true,
      },
    });

    void prisma.auditLog.create({
      data: {
        event: 'USER_ROLE_UPDATED',
        userId: auth.user.id,
        resourceType: 'User',
        resourceId: targetUser.id,
        details: `Superadmin ${actorName} changed ${targetName} role from ${oldRole} to ${requestedRole}`,
      },
    }).catch((auditErr) => {
      console.warn('[AuditLog] Failed to record USER_ROLE_UPDATED asynchronously:', auditErr);
    });

    return NextResponse.json({
      success: true,
      user: updatedUser,
    });
  } catch (error) {
    console.error('Failed to update user role:', error);
    return NextResponse.json(
      { error: 'An unexpected internal error occurred while updating user role.' },
      { status: 500 }
    );
  }
}
