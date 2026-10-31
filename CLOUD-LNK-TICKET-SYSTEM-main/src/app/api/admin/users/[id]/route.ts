import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { GlobalRole, SpaceRole, Prisma } from '@prisma/client';
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
      error: 'Forbidden: Superadmin clearance required to manage users and permissions.',
      status: 403,
    };
  }

  return { user: sessionData.user };
}

// PATCH /api/admin/users/[id] - Update user details, role, status, or space clearances
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
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Invalid or missing JSON payload.', code: 'INVALID_JSON' },
        { status: 400 }
      );
    }

    const { name, email, globalRole, isActive, password, spaceIds } = body;

    const existingUser = await prisma.user.findUnique({
      where: { id },
      include: { spaceMemberships: true },
    });

    if (!existingUser) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    // Guard: Prevent self-deactivation
    if (id === auth.user.id && isActive === false) {
      return NextResponse.json(
        { error: 'You cannot deactivate your own active Superadmin account.' },
        { status: 400 }
      );
    }

    // Guard: Prevent self-demotion
    if (id === auth.user.id && globalRole && globalRole !== GlobalRole.SUPERADMIN) {
      return NextResponse.json(
        { error: 'You cannot demote your own Superadmin account.' },
        { status: 400 }
      );
    }

    // Guard: Prevent deactivating or demoting the last active Superadmin
    if (
      existingUser.globalRole === GlobalRole.SUPERADMIN &&
      (isActive === false || (globalRole && globalRole !== GlobalRole.SUPERADMIN))
    ) {
      const otherActiveSuperadmins = await prisma.user.count({
        where: {
          globalRole: GlobalRole.SUPERADMIN,
          isActive: true,
          NOT: { id },
        },
      });

      if (otherActiveSuperadmins === 0) {
        return NextResponse.json(
          { error: 'Cannot deactivate or demote the last remaining active Superadmin account.' },
          { status: 400 }
        );
      }
    }

    const updateData: Record<string, any> = {};

    if (name !== undefined) updateData.name = String(name).trim();
    if (email !== undefined) updateData.email = String(email).trim().toLowerCase();
    if (globalRole !== undefined) updateData.globalRole = globalRole as GlobalRole;
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);

    // If password reset provided
    if (password) {
      updateData.passwordHash = await bcrypt.hash(String(password), 10);
    }

    // Execute update and space member synchronization in transaction
    const updatedUser = await withDbRetry(() =>
      prisma.$transaction(async (tx) => {
        // If deactivating user, terminate all active sessions immediately
        if (isActive === false) {
          await tx.session.deleteMany({
            where: { userId: id },
          });
        }

        await tx.user.update({
          where: { id },
          data: updateData,
        });

        // Synchronize Space Memberships if spaceIds array was explicitly provided
        if (Array.isArray(spaceIds)) {
          // Delete previous space memberships
          await tx.spaceMember.deleteMany({
            where: { userId: id },
          });

          // Insert new space memberships
          if (spaceIds.length > 0) {
            const effectiveRole =
              (globalRole ?? existingUser.globalRole) === GlobalRole.SUPERADMIN
                ? SpaceRole.ADMIN
                : SpaceRole.MEMBER;

            await tx.spaceMember.createMany({
              data: spaceIds.map((spaceId: string) => ({
                userId: id,
                spaceId,
                role: effectiveRole,
              })),
            });
          }
        }

        return tx.user.findUniqueOrThrow({
          where: { id },
          select: {
            id: true,
            username: true,
            email: true,
            name: true,
            globalRole: true,
            isActive: true,
            updatedAt: true,
            spaceMemberships: {
              select: {
                spaceId: true,
                role: true,
                space: { select: { id: true, name: true, key: true } },
              },
            },
          },
        });
      }, DB_TRANSACTION_OPTIONS)
    );

    // Record audit log entry asynchronously
    void prisma.auditLog.create({
      data: {
        event: 'USER_UPDATED_BY_ADMIN',
        userId: auth.user.id,
        resourceType: 'User',
        resourceId: id,
        details: JSON.stringify({
          updatedFields: Object.keys(body),
          targetUsername: updatedUser.username,
          isActive: updatedUser.isActive,
          spacesAssigned: updatedUser.spaceMemberships.length,
        }),
      },
    }).catch((auditErr) => {
      console.warn('[AuditLog] Failed to record USER_UPDATED_BY_ADMIN asynchronously:', auditErr);
    });

    // Invalidate user caches
    invalidateCachePrefix('admin:users');
    invalidateCachePrefix('users:');

    return NextResponse.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error('Failed to update user:', error);
    return NextResponse.json(
      { error: 'An unexpected internal error occurred while updating the user.' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/users/[id] - Permanently delete a user account with comprehensive dependency cleanup
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedSuperadmin(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id } = await context.params;

    // Guard: Prevent self-deletion
    if (id === auth.user.id) {
      return NextResponse.json(
        { error: 'You cannot delete your own active Superadmin account.' },
        { status: 400 }
      );
    }

    // Verify target user exists
    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        globalRole: true,
      },
    });

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    // Guard: Prevent deleting the last remaining Superadmin
    if (targetUser.globalRole === GlobalRole.SUPERADMIN) {
      const otherSuperadmins = await prisma.user.count({
        where: {
          globalRole: GlobalRole.SUPERADMIN,
          NOT: { id },
        },
      });

      if (otherSuperadmins === 0) {
        return NextResponse.json(
          { error: 'Cannot delete the last remaining active Superadmin account.' },
          { status: 400 }
        );
      }
    }

    // Execute atomic dependency cleanup and deletion with retry guard
    await withDbRetry(() =>
      prisma.$transaction(async (tx) => {
        // 1. Revoke and delete all active sessions
        await tx.session.deleteMany({
          where: { userId: id },
        });

        // 2. Clear user preferences
        await tx.userPreference.deleteMany({
          where: { userId: id },
        });

        // 3. Clear user notifications
        await tx.notification.deleteMany({
          where: { userId: id },
        });

        // 4. Remove space memberships
        await tx.spaceMember.deleteMany({
          where: { userId: id },
        });

        // 5. Unassign department head role on spaces
        await tx.space.updateMany({
          where: { departmentHeadId: id },
          data: { departmentHeadId: null },
        });

        // 6. Unassign tasks assigned to this user (set assigneeId to null)
        await tx.task.updateMany({
          where: { assigneeId: id },
          data: { assigneeId: null },
        });

        // 7. Disconnect user from contributed tasks (implicit many-to-many)
        await tx.user.update({
          where: { id },
          data: {
            contributedTasks: { set: [] },
          },
        });

        // 8. Reassign tasks created by this user to the executing Superadmin so tickets are preserved
        await tx.task.updateMany({
          where: { createdById: id },
          data: { createdById: auth.user.id },
        });

        // 9. Reassign attachments uploaded by this user to the executing Superadmin
        await tx.attachment.updateMany({
          where: { uploaderId: id },
          data: { uploaderId: auth.user.id },
        });

        // 10. Nullify actorId in TaskHistory to preserve audit chronology without foreign key violation
        await tx.taskHistory.updateMany({
          where: { actorId: id },
          data: { actorId: null },
        });

        // 11. Delete the user record
        await tx.user.delete({
          where: { id },
        });
      }, DB_TRANSACTION_OPTIONS)
    );

    // 12. Create audit log record asynchronously
    void prisma.auditLog.create({
      data: {
        event: 'USER_DELETED_BY_ADMIN',
        userId: auth.user.id,
        resourceType: 'User',
        resourceId: id,
        details: JSON.stringify({
          deletedUsername: targetUser.username,
          deletedEmail: targetUser.email,
          deletedName: targetUser.name,
          deletedRole: targetUser.globalRole,
        }),
      },
    }).catch((auditErr) => {
      console.warn('[AuditLog] Failed to record USER_DELETED_BY_ADMIN asynchronously:', auditErr);
    });

    // Invalidate user caches
    invalidateCachePrefix('admin:users');
    invalidateCachePrefix('users:');

    return NextResponse.json({
      success: true,
      message: `User @${targetUser.username} (${targetUser.name}) was permanently deleted.`,
    });
  } catch (error) {
    console.error('Failed to delete user:', error);
    return NextResponse.json(
      { error: 'An unexpected internal error occurred while deleting the user.' },
      { status: 500 }
    );
  }
}
