import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { GlobalRole, SpaceRole } from '@prisma/client';
import { prisma } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { getOrSetCache, invalidateCachePrefix } from '@/lib/server-cache';

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

// GET /api/admin/users - List all users and available spaces
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedSuperadmin(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const data = await getOrSetCache(
      'admin:users',
      60_000,
      async () => {
        const [users, spaces] = await Promise.all([
          prisma.user.findMany({
            select: {
              id: true,
              username: true,
              email: true,
              name: true,
              globalRole: true,
              isActive: true,
              createdAt: true,
              updatedAt: true,
              spaceMemberships: {
                select: {
                  id: true,
                  spaceId: true,
                  role: true,
                  space: {
                    select: {
                      id: true,
                      name: true,
                      key: true,
                    },
                  },
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          }),
          prisma.space.findMany({
            select: {
              id: true,
              name: true,
              key: true,
              description: true,
              departmentHeadId: true,
              departmentHead: {
                select: {
                  id: true,
                  name: true,
                  username: true,
                  email: true,
                },
              },
              members: {
                select: {
                  id: true,
                  userId: true,
                  role: true,
                },
              },
              lists: {
                select: {
                  id: true,
                  name: true,
                },
              },
              _count: {
                select: {
                  tasks: true,
                  members: true,
                },
              },
            },
            orderBy: { name: 'asc' },
          }),
        ]);
        return { users, spaces };
      },
      { swrMs: 300_000 }
    );

    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to retrieve users:', error);
    return NextResponse.json(
      { error: 'An unexpected internal error occurred while fetching users.' },
      { status: 500 }
    );
  }
}

// POST /api/admin/users - Provision new user with role and space delegation
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedSuperadmin(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json();
    const { name, username, email, password, globalRole, spaceIds = [] } = body;

    if (!name || !username || !email || !password || !globalRole) {
      return NextResponse.json(
        { error: 'Name, username, email, password, and globalRole are required.' },
        { status: 400 }
      );
    }

    const validRoles = [GlobalRole.SUPERADMIN, GlobalRole.ADMIN, GlobalRole.EMPLOYEE];
    if (!validRoles.includes(globalRole as GlobalRole)) {
      return NextResponse.json(
        { error: `Invalid globalRole. Must be one of: ${validRoles.join(', ')}` },
        { status: 400 }
      );
    }

    const normalizedUsername = String(username).trim().toLowerCase();
    const normalizedEmail = String(email).trim().toLowerCase();

    // Check uniqueness
    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ username: normalizedUsername }, { email: normalizedEmail }],
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: 'A user with that username or email address already exists.' },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    // Create user and space memberships in a single atomic nested query (0 transaction overhead)
    const newUser = await prisma.user.create({
      data: {
        name: String(name).trim(),
        username: normalizedUsername,
        email: normalizedEmail,
        passwordHash,
        globalRole: globalRole as GlobalRole,
        isActive: true,
        ...(Array.isArray(spaceIds) && spaceIds.length > 0
          ? {
              spaceMemberships: {
                create: spaceIds.map((spaceId: string) => ({
                  spaceId,
                  role: globalRole === GlobalRole.SUPERADMIN ? SpaceRole.ADMIN : SpaceRole.MEMBER,
                })),
              },
            }
          : {}),
      },
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        globalRole: true,
        isActive: true,
        createdAt: true,
        spaceMemberships: {
          select: {
            spaceId: true,
            role: true,
            space: { select: { id: true, name: true, key: true } },
          },
        },
      },
    });

    // Record audit log entry asynchronously in background
    void prisma.auditLog.create({
      data: {
        event: 'USER_CREATED_BY_ADMIN',
        userId: auth.user.id,
        resourceType: 'User',
        resourceId: newUser.id,
        details: JSON.stringify({
          createdUsername: newUser.username,
          createdRole: newUser.globalRole,
          assignedSpacesCount: newUser.spaceMemberships.length,
        }),
      },
    }).catch((auditErr) => {
      console.warn('[AuditLog] Failed to record USER_CREATED_BY_ADMIN asynchronously:', auditErr);
    });

    // Invalidate user caches
    invalidateCachePrefix('admin:users');
    invalidateCachePrefix('users:');

    return NextResponse.json({ success: true, user: newUser }, { status: 201 });
  } catch (error) {
    console.error('Failed to create user:', error);
    return NextResponse.json(
      { error: 'An unexpected internal error occurred while creating the user.' },
      { status: 500 }
    );
  }
}
