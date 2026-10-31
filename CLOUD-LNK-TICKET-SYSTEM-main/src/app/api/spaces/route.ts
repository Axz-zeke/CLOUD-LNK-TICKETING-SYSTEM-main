import { NextRequest, NextResponse } from 'next/server';
import { prisma, withDbRetry } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { getUserAssignedSpaceIds } from '@/lib/security/rbac';
import { OPEN_ONLY_TASK_STATUS_FILTER, getStatusCategory } from '@/lib/status-utils';
import { getCollaboratedActiveCount } from '@/lib/collaboration';
import { getOrSetCache, invalidateCachePrefix } from '@/lib/server-cache';

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

// GET /api/spaces - Returns spaces permitted for the active user
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user } = auth;
    const forceFresh =
      request.nextUrl.searchParams.get('fresh') === '1' ||
      Boolean(request.nextUrl.searchParams.get('_t'));
    const responsePayload = await getOrSetCache(
      `spaces:user:${user.id}`,
      120_000, // 2 minutes fresh TTL
      async () => {
        let spaceWhereClause: Record<string, any> = {};

        if (user.globalRole === 'SUPERADMIN') {
          // Superadmin sees all spaces globally
          spaceWhereClause = {};
        } else {
          // Staff and Requesters only see spaces they hold explicit membership in
          const assignedSpaceIds = await getUserAssignedSpaceIds(user.id);
          spaceWhereClause = {
            id: {
              in: assignedSpaceIds,
            },
          };
        }

        const [workspace, spaces, collaboratedCount] = await Promise.all([
          prisma.workspace.findFirst({
            select: {
              id: true,
              name: true,
              slug: true,
            },
          }),
          prisma.space.findMany({
            relationLoadStrategy: 'join',
            where: spaceWhereClause,
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
            select: {
              userId: true,
              role: true,
            },
          },
          lists: {
            orderBy: { order: 'asc' },
            select: {
              id: true,
              spaceId: true,
              name: true,
              description: true,
              color: true,
              order: true,
              isPrivate: true,
              _count: {
                select: {
                  tasks: {
                    where: OPEN_ONLY_TASK_STATUS_FILTER,
                  },
                },
              },
            },
          },
          statuses: {
            orderBy: { order: 'asc' },
            select: {
              id: true,
              name: true,
              color: true,
              order: true,
              isCompleted: true,
              isClosed: true,
            },
          },
          _count: {
            select: {
              tasks: {
                where: OPEN_ONLY_TASK_STATUS_FILTER,
              },
              members: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      getCollaboratedActiveCount(user, prisma),
    ]);

    const isSuperadmin = user.globalRole === 'SUPERADMIN';
    const mappedSpaces = spaces.map((sp) => {
      const isMember =
        isSuperadmin ||
        sp.departmentHeadId === user.id ||
        sp.members?.some((m) => m.userId === user.id);

      const visibleLists = isMember ? sp.lists : sp.lists.filter((l) => !l.isPrivate);

      let desc = sp.description;
      let color = '#3B82F6';
      let icon = 'Building';
      if (sp.description && sp.description.startsWith('{')) {
        try {
          const parsed = JSON.parse(sp.description);
          if (parsed && typeof parsed === 'object') {
            desc = parsed.text ?? null;
            color = parsed.color || color;
            icon = parsed.icon || icon;
          }
        } catch {
          // Plain description
        }
      }
      return {
        ...sp,
        statuses: sp.statuses.map((st) => ({
          ...st,
          category: getStatusCategory(st),
        })),
        lists: visibleLists,
        description: desc,
        color,
        icon,
      };
    });

      return {
        workspace,
        spaces: mappedSpaces,
        userRole: user.globalRole,
        collaboratedCount,
      };
    }, { swrMs: 600_000, forceFresh });

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('Failed to fetch spaces:', error);
    return NextResponse.json(
      { error: 'An unexpected internal error occurred while fetching spaces.' },
      { status: 500 }
    );
  }
}

// POST /api/spaces - Provision a new Department Space (Superadmin only)
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user } = auth;
    if (user.globalRole !== 'SUPERADMIN') {
      return NextResponse.json(
        { error: 'Forbidden: Superadmin clearance required to create Spaces.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      name,
      key,
      description,
      color = '#3B82F6',
      icon = 'Building',
      lists,
      statuses,
      statusPreset,
      memberUserIds,
    } = body;

    if (!name || !key) {
      return NextResponse.json(
        { error: 'Space name and key prefix are required.' },
        { status: 400 }
      );
    }

    const trimmedName = String(name).trim();
    const trimmedKey = String(key).trim().toUpperCase();

    if (trimmedKey.length < 2 || trimmedKey.length > 8 || !/^[A-Z0-9_-]+$/.test(trimmedKey)) {
      return NextResponse.json(
        { error: 'Space key must be between 2 and 8 uppercase alphanumeric characters.' },
        { status: 400 }
      );
    }

    const slug = trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    // 1. In-memory pre-flight lookups: cached workspace and clearance users (0ms)
    const [workspace, activeClearanceUsers] = await Promise.all([
      getOrSetCache('workspace:singleton', 3_600_000, () => prisma.workspace.findFirstOrThrow()),
      getOrSetCache('clearance:users', 600_000, () =>
        prisma.user.findMany({
          where: {
            isActive: true,
            OR: [{ username: 'boss_user' }, { globalRole: 'SUPERADMIN' }],
          },
          select: { id: true },
        })
      ),
    ]);

    // 2. Extract queue lists from multiple possible payload keys:
    // lists, queues, initialLists, queueLists, defaultList, initialListName, listName
    const rawListsInput =
      lists ??
      body.queues ??
      body.initialLists ??
      body.queueLists ??
      body.defaultList ??
      body.initialListName ??
      body.listName;

    let initialLists: Array<{
      name: string;
      description?: string | null;
      color?: string | null;
      isPrivate?: boolean;
    }> = [];

    if (Array.isArray(rawListsInput)) {
      for (const item of rawListsInput) {
        if (typeof item === 'string') {
          const trimmed = item.trim();
          if (trimmed) {
            initialLists.push({ name: trimmed });
          }
        } else if (item && typeof item === 'object') {
          const name = String(item.name || item.title || '').trim();
          if (name) {
            initialLists.push({
              name,
              description: item.description ? String(item.description).trim() : null,
              color: item.color ? String(item.color).trim() : null,
              isPrivate: Boolean(item.isPrivate),
            });
          }
        }
      }
    } else if (typeof rawListsInput === 'string') {
      const trimmed = rawListsInput.trim();
      if (trimmed) {
        initialLists.push({ name: trimmed });
      }
    }

    // Default fallback if no queues configured
    if (initialLists.length === 0) {
      initialLists = [
        { name: 'General Inquiries' },
        { name: 'Urgent Requests' },
      ];
    }

    // Determine lifecycle statuses
    let initialStatuses: Array<{
      name: string;
      color: string;
      order: number;
      isCompleted?: boolean;
      isClosed?: boolean;
    }> = [];

    if (Array.isArray(statuses) && statuses.length > 0) {
      initialStatuses = statuses.map((st: any, idx: number) => ({
        name: String(st.name || `Status ${idx + 1}`).trim(),
        color: String(st.color || '#6B7280').trim(),
        order: typeof st.order === 'number' ? st.order : idx,
        isCompleted: Boolean(st.isCompleted),
        isClosed: Boolean(st.isClosed),
      }));
    } else if (statusPreset === 'simple') {
      initialStatuses = [
        { name: 'To Do', color: '#3B82F6', order: 0 },
        { name: 'In Progress', color: '#F59E0B', order: 1 },
        { name: 'Done', color: '#10B981', order: 2, isCompleted: true, isClosed: true },
      ];
    } else if (statusPreset === 'bug') {
      initialStatuses = [
        { name: 'Reported', color: '#EF4444', order: 0 },
        { name: 'Triaged', color: '#8B5CF6', order: 1 },
        { name: 'In Fix', color: '#F59E0B', order: 2 },
        { name: 'Verified', color: '#10B981', order: 3, isCompleted: true, isClosed: true },
      ];
    } else {
      // Standard 5-stage default
      initialStatuses = [
        { name: 'Open', color: '#3B82F6', order: 0 },
        { name: 'In Progress', color: '#F59E0B', order: 1 },
        { name: 'Pending User', color: '#8B5CF6', order: 2 },
        { name: 'Resolved', color: '#10B981', order: 3, isCompleted: true },
        { name: 'Closed', color: '#6B7280', order: 4, isCompleted: true, isClosed: true },
      ];
    }

    // Encode metadata in description for color and icon preservation
    const cleanDescText = description ? String(description).trim() : '';
    const storedDescription = JSON.stringify({
      text: cleanDescText || null,
      color: String(color || '#3B82F6'),
      icon: String(icon || 'Building'),
    });

    // Resolve Memberships:
    // a) Creator (ADMIN)
    // b) Universal Executive Clearance (e.g. boss_user and Superadmins) (ADMIN)
    // c) Selected staff members from memberUserIds (MEMBER)
    const memberMap = new Map<string, 'ADMIN' | 'MEMBER'>();
    memberMap.set(user.id, 'ADMIN');

    for (const u of activeClearanceUsers) {
      if (!memberMap.has(u.id)) {
        memberMap.set(u.id, 'ADMIN');
      }
    }

    if (Array.isArray(memberUserIds)) {
      for (const uid of memberUserIds) {
        const stringUid = String(uid).trim();
        if (stringUid && !memberMap.has(stringUid)) {
          memberMap.set(stringUid, 'MEMBER');
        }
      }
    }

    const memberData = Array.from(memberMap.entries()).map(([userId, role]) => ({
      userId,
      role,
    }));

    // Execute SINGLE atomic nested write - Zero interactive transactions, zero P2028 timeouts
    let createdSpace;
    try {
      createdSpace = await prisma.space.create({
        data: {
          workspaceId: workspace.id,
          name: trimmedName,
          key: trimmedKey,
          slug,
          description: storedDescription,
          statuses: {
            create: initialStatuses.map((st) => ({
              name: st.name,
              color: st.color,
              order: st.order,
              isCompleted: Boolean(st.isCompleted),
              isClosed: Boolean(st.isClosed),
            })),
          },
          lists: {
            create: initialLists.map((item, idx) => ({
              name: item.name,
              description: item.description || null,
              color: item.color || null,
              isPrivate: Boolean(item.isPrivate),
              order: idx + 1,
            })),
          },
          members: {
            create: memberData,
          },
        },
        include: {
          departmentHead: {
            select: { id: true, name: true, username: true, email: true },
          },
          members: {
            select: { userId: true, role: true },
          },
          lists: {
            orderBy: { order: 'asc' },
            select: {
              id: true,
              spaceId: true,
              name: true,
              description: true,
              color: true,
              order: true,
              isPrivate: true,
            },
          },
          statuses: {
            orderBy: { order: 'asc' },
            select: {
              id: true,
              spaceId: true,
              name: true,
              color: true,
              order: true,
              isCompleted: true,
              isClosed: true,
            },
          },
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        return NextResponse.json(
          { error: `A Space with key '${trimmedKey}' or name '${trimmedName}' already exists.` },
          { status: 409 }
        );
      }
      throw err;
    }

    const formattedSpace = {
      ...createdSpace,
      statuses: createdSpace.statuses.map((st) => ({
        ...st,
        category: getStatusCategory(st),
      })),
      lists: createdSpace.lists.map((lst) => ({
        ...lst,
        _count: { tasks: 0 },
      })),
      _count: {
        tasks: 0,
        members: memberData.length,
      },
      description: cleanDescText || null,
      color: color || '#3B82F6',
      icon: icon || 'Building',
    };

    // Invalidate server caches
    invalidateCachePrefix('spaces:');
    invalidateCachePrefix('admin:');
    invalidateCachePrefix('user:spaces:');
    invalidateCachePrefix('rbac:');
    invalidateCachePrefix('clearance:');

    // Record AuditLog asynchronously in the background so it adds 0ms to user wait time
    void prisma.auditLog
      .create({
        data: {
          event: 'SPACE_CREATED',
          resourceType: 'Space',
          resourceId: createdSpace.id,
          userId: user.id,
          details: JSON.stringify({
            name: createdSpace.name,
            key: createdSpace.key,
            memberCount: memberData.length,
            listsCount: initialLists.length,
          }),
        },
      })
      .catch((auditErr) => {
        console.warn('[AuditLog] Failed to asynchronously record SPACE_CREATED:', auditErr);
      });

    return NextResponse.json({ success: true, space: formattedSpace }, { status: 201 });
  } catch (error) {
    console.error('Failed to create space:', error);
    return NextResponse.json(
      { error: 'An unexpected internal error occurred while creating the space.' },
      { status: 500 }
    );
  }
}
