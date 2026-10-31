import { NextRequest, NextResponse } from 'next/server';
import { SpaceRole } from '@prisma/client';
import { prisma, withDbRetry, DB_TRANSACTION_OPTIONS } from '@/lib/db';
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
      error: 'Forbidden: Superadmin clearance required to manage department staffing and delegation.',
      status: 403,
    };
  }

  return { user: sessionData.user };
}

// PATCH /api/spaces/[id]/management - Superadmin Department Staffing & Head Delegation
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
    const { departmentHeadId, memberUserIds } = body;

    const space = await prisma.space.findUnique({
      where: { id },
      include: {
        departmentHead: true,
      },
    });

    if (!space) {
      return NextResponse.json({ error: 'Department space not found.' }, { status: 404 });
    }

    let headCandidate: any = null;
    let shouldUpdateHead = false;

    if (departmentHeadId !== undefined) {
      shouldUpdateHead = true;
      if (departmentHeadId !== null && String(departmentHeadId).trim() !== '') {
        headCandidate = await prisma.user.findUnique({
          where: { id: String(departmentHeadId).trim() },
          select: {
            id: true,
            username: true,
            name: true,
            email: true,
            globalRole: true,
            isActive: true,
          },
        });

        if (!headCandidate || !headCandidate.isActive) {
          return NextResponse.json(
            { error: 'Designated Department Head user not found or is inactive.' },
            { status: 400 }
          );
        }

        // Validate designated head has ADMIN or SUPERADMIN privileges
        if (headCandidate.globalRole !== 'ADMIN' && headCandidate.globalRole !== 'SUPERADMIN') {
          return NextResponse.json(
            {
              error:
                'Designated Department Head must be an active user with ADMIN or SUPERADMIN privileges.',
            },
            { status: 400 }
          );
        }
      }
    }

    // 1. Pre-calculate final user IDs and user map outside the transaction
    let finalUserIds: string[] = [];
    let userMap = new Map<string, any>();

    if (Array.isArray(memberUserIds)) {
      const memberIdSet = new Set(
        memberUserIds.map((m: any) => String(m).trim()).filter(Boolean)
      );

      // Ensure designated department head is automatically included in members
      if (headCandidate) {
        memberIdSet.add(headCandidate.id);
      } else if (space.departmentHeadId && departmentHeadId === undefined) {
        memberIdSet.add(space.departmentHeadId);
      }

      finalUserIds = Array.from(memberIdSet);

      if (finalUserIds.length > 0) {
        const users = await prisma.user.findMany({
          where: { id: { in: finalUserIds } },
          select: { id: true, globalRole: true },
        });
        userMap = new Map(users.map((u) => [u.id, u.globalRole]));
      }
    }

    // 2. Atomic transaction for synchronizing membership and updating space
    const updatedSpace = await withDbRetry(() =>
      prisma.$transaction(async (tx) => {
        if (Array.isArray(memberUserIds)) {
          // Prune existing space members
          await tx.spaceMember.deleteMany({
            where: { spaceId: id },
          });

          // Insert new space members
          if (finalUserIds.length > 0) {
            await tx.spaceMember.createMany({
              data: finalUserIds.map((userId) => {
                const gRole = userMap.get(userId);
                const isHead =
                  (headCandidate && headCandidate.id === userId) ||
                  (space.departmentHeadId === userId && departmentHeadId === undefined);
                const isStaff = isHead || gRole === 'SUPERADMIN' || gRole === 'ADMIN';

                return {
                  spaceId: id,
                  userId,
                  role: isStaff ? SpaceRole.ADMIN : SpaceRole.MEMBER,
                };
              }),
            });
          }
        } else if (headCandidate) {
          // If memberUserIds was not passed but a new head was assigned, ensure new head is in members
          await tx.spaceMember.upsert({
            where: {
              spaceId_userId: {
                spaceId: id,
                userId: headCandidate.id,
              },
            },
            create: {
              spaceId: id,
              userId: headCandidate.id,
              role: SpaceRole.ADMIN,
            },
            update: {
              role: SpaceRole.ADMIN,
            },
          });
        }

        // Update Space departmentHeadId if requested
        const spaceUpdateData: Record<string, any> = {};
        if (shouldUpdateHead) {
          spaceUpdateData.departmentHeadId = headCandidate ? headCandidate.id : null;
        }

        return tx.space.update({
          where: { id },
          data: spaceUpdateData,
          include: {
            departmentHead: {
              select: {
                id: true,
                name: true,
                username: true,
                email: true,
              },
            },
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    username: true,
                    email: true,
                    globalRole: true,
                  },
                },
              },
            },
            _count: {
              select: {
                tasks: true,
                members: true,
              },
            },
          },
        });
      }, DB_TRANSACTION_OPTIONS)
    );

    // 3. Write immutable AuditLog asynchronously in background
    const actorName = auth.user.name || auth.user.username;
    const headName = headCandidate
      ? `${headCandidate.name} (@${headCandidate.username})`
      : shouldUpdateHead && !headCandidate
      ? 'None'
      : updatedSpace.departmentHead
      ? `${updatedSpace.departmentHead.name} (@${updatedSpace.departmentHead.username})`
      : 'None';

    void prisma.auditLog.create({
      data: {
        event: 'DEPARTMENT_STAFFING_UPDATED',
        userId: auth.user.id,
        resourceType: 'Space',
        resourceId: id,
        details: `Superadmin ${actorName} updated staffing for ${space.name}. New Head: ${headName}`,
      },
    }).catch((auditErr) => {
      console.warn('[AuditLog] Failed to record DEPARTMENT_STAFFING_UPDATED asynchronously:', auditErr);
    });

    return NextResponse.json({
      success: true,
      space: updatedSpace,
    });
  } catch (error) {
    console.error('Failed to update department staffing:', error);
    return NextResponse.json(
      { error: 'An unexpected internal error occurred while updating department staffing.' },
      { status: 500 }
    );
  }
}
