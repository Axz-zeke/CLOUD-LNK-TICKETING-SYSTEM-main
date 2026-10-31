import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma, withDbRetry, DB_TRANSACTION_OPTIONS } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { invalidateCachePrefix } from '@/lib/server-cache';

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
      error: 'Forbidden: Superadmin clearance required to delete department spaces.',
      status: 403,
    };
  }

  return { user: sessionData.user };
}

// DELETE /api/admin/spaces/[spaceId]
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ spaceId: string }> }
) {
  try {
    const auth = await getAuthenticatedSuperadmin(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user } = auth;
    const { spaceId } = await context.params;

    if (!spaceId) {
      return NextResponse.json(
        { error: 'INVALID_REQUEST', message: 'Space ID is required.' },
        { status: 400 }
      );
    }

    // Parse body for superadminPassword
    let superadminPassword = '';
    try {
      const body = await request.json();
      superadminPassword = body.superadminPassword || '';
    } catch {
      return NextResponse.json(
        {
          error: 'INVALID_REQUEST',
          message: 'Request body must be valid JSON with superadminPassword.',
        },
        { status: 400 }
      );
    }

    if (!superadminPassword || typeof superadminPassword !== 'string') {
      return NextResponse.json(
        { error: 'PASSWORD_REQUIRED', message: 'Superadmin password is required.' },
        { status: 400 }
      );
    }

    // Retrieve superadmin with passwordHash
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, username: true, passwordHash: true, globalRole: true },
    });

    if (!dbUser || !dbUser.passwordHash) {
      return NextResponse.json(
        { error: 'INVALID_CREDENTIALS', message: 'Incorrect Superadmin password.' },
        { status: 401 }
      );
    }

    // Verify bcrypt password
    const isPasswordValid = await bcrypt.compare(superadminPassword, dbUser.passwordHash);
    if (!isPasswordValid) {
      // Record audit log for failed deletion authorization attempt
      await prisma.auditLog.create({
        data: {
          event: 'SPACE_DELETE_FAILED_INVALID_PASSWORD',
          userId: user.id,
          resourceType: 'Space',
          resourceId: spaceId,
          ipAddress: request.headers.get('x-forwarded-for') || '127.0.0.1',
          details: JSON.stringify({
            message: `User ${user.username} entered incorrect password for space deletion`,
            attemptedSpaceId: spaceId,
          }),
        },
      });

      return NextResponse.json(
        { error: 'INVALID_CREDENTIALS', message: 'Incorrect Superadmin password.' },
        { status: 401 }
      );
    }

    // Check space existence and associated counts
    const space = await prisma.space.findUnique({
      where: { id: spaceId },
      include: {
        _count: {
          select: {
            tasks: true,
            lists: true,
            members: true,
          },
        },
      },
    });

    if (!space) {
      return NextResponse.json(
        { error: 'NOT_FOUND', message: 'Department space not found.' },
        { status: 404 }
      );
    }

    // Safeguard: Ensure at least one department space remains in the workspace
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

    // 1. Pre-gather all task IDs in this space outside the transaction
    const tasks = await prisma.task.findMany({
      where: { spaceId },
      select: { id: true },
    });
    const taskIds = tasks.map((t) => t.id);

    // 2. Perform cascading deletion inside guarded transaction
    await withDbRetry(() =>
      prisma.$transaction(async (tx) => {
        if (taskIds.length > 0) {
          await tx.notification.deleteMany({
            where: { taskId: { in: taskIds } },
          });
          await tx.taskComment.deleteMany({
            where: { taskId: { in: taskIds } },
          });
          await tx.attachment.deleteMany({
            where: { taskId: { in: taskIds } },
          });
          await tx.task.deleteMany({
            where: { spaceId },
          });
        }

        // Delete lists (queues), statuses, SLA, and memberships
        await tx.list.deleteMany({ where: { spaceId } });
        await tx.taskStatus.deleteMany({ where: { spaceId } });
        await tx.slaPolicy.deleteMany({ where: { spaceId } });
        await tx.spaceMember.deleteMany({ where: { spaceId } });

        // Delete the space itself
        await tx.space.delete({
          where: { id: spaceId },
        });
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

    // 4. Record security audit log asynchronously
    void prisma.auditLog.create({
      data: {
        event: 'SPACE_DELETED',
        userId: user.id,
        resourceType: 'Space',
        resourceId: spaceId,
        ipAddress: request.headers.get('x-forwarded-for') || '127.0.0.1',
        details: JSON.stringify({
          deletedSpaceName: space.name,
          deletedSpaceKey: space.key,
          ticketsWiped: space._count.tasks,
          queuesWiped: space._count.lists,
          membersRemoved: space._count.members,
          actor: user.username,
        }),
      },
    }).catch((auditErr) => {
      console.warn('[AuditLog] Failed to record SPACE_DELETED asynchronously:', auditErr);
    });

    return NextResponse.json({
      success: true,
      message: `Department space '${space.name}' (${space.key}) successfully deleted.`,
    });
  } catch (error) {
    console.error('Failed to delete department space:', error);
    return NextResponse.json(
      {
        error: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Internal error deleting space',
      },
      { status: 500 }
    );
  }
}
