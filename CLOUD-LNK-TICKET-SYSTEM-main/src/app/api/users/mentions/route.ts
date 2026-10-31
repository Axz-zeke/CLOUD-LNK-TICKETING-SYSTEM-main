import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';

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

import { getOrSetCache, peekCache } from '@/lib/server-cache';

/**
 * GET /api/users/mentions?spaceId=<optional>
 * Returns mentionable users in the workspace for autocomplete.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = request.nextUrl;
    const spaceId = searchParams.get('spaceId');
    const taskId = searchParams.get('taskId');

    let task: any = null;
    const authorizedSpaceIds = new Set<string>();

    if (taskId) {
      task =
        peekCache<any>(`task:detail:${taskId}`) ||
        peekCache<any[]>('tasks:master:all')?.find((t) => t.id === taskId) ||
        (await prisma.task.findUnique({
          where: { id: taskId },
          select: {
            id: true,
            spaceId: true,
            originSpaceId: true,
            createdById: true,
            assigneeId: true,
            space: { select: { id: true, name: true } },
            originSpace: { select: { id: true, name: true } },
            history: {
              where: { actionType: 'HANDOFF_TRANSFER' },
              select: {
                fromSpaceId: true,
                toSpaceId: true,
                fromSpace: { select: { id: true, name: true } },
                toSpace: { select: { id: true, name: true } },
              },
            },
          },
        }));

      if (task) {
        if (task.spaceId) authorizedSpaceIds.add(task.spaceId);
        if (task.originSpaceId) authorizedSpaceIds.add(task.originSpaceId);
        if (Array.isArray(task.history)) {
          for (const h of task.history) {
            if (h.fromSpaceId) authorizedSpaceIds.add(h.fromSpaceId);
            if (h.toSpaceId) authorizedSpaceIds.add(h.toSpaceId);
          }
        }
      }
    } else if (spaceId) {
      authorizedSpaceIds.add(spaceId);
    }

    const users = await getOrSetCache(
      'users:all:mentions',
      120_000,
      async () => {
        return prisma.user.findMany({
          where: { isActive: true },
          select: {
            id: true,
            username: true,
            name: true,
            email: true,
            globalRole: true,
            spaceMemberships: {
              select: {
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
            headedSpaces: {
              select: {
                id: true,
                name: true,
                key: true,
              },
            },
          },
          orderBy: { name: 'asc' },
        });
      },
      { swrMs: 600_000 }
    );

    // If taskId is provided, restrict to authorized ticket scope only:
    // 1. Members of authorizedSpaceIds
    // 2. Creator or Assignee
    // 3. SUPERADMIN
    const candidateUsers = taskId
      ? users.filter((u) => {
        if (u.globalRole === 'SUPERADMIN') return true;
        if (task && (u.id === task.createdById || u.id === task.assigneeId)) return true;
        const isInAuthorizedSpace =
          u.spaceMemberships.some((m) => authorizedSpaceIds.has(m.spaceId)) ||
          u.headedSpaces.some((s) => authorizedSpaceIds.has(s.id));
        return isInAuthorizedSpace;
      })
      : users;

    const formatted = candidateUsers.map((u) => {
      const activeSpaceId = task?.spaceId || spaceId;
      const isSpaceMember = Boolean(
        activeSpaceId &&
        (u.spaceMemberships.some((m) => m.spaceId === activeSpaceId) ||
          u.headedSpaces.some((s) => s.id === activeSpaceId) ||
          u.globalRole === 'SUPERADMIN')
      );

      // Compute precise Department Name badge (e.g. "Human Resources • Admin", "MIS • Staff", "Purchasing • Lead")
      let departmentBadge = 'Staff';
      if (u.globalRole === 'SUPERADMIN') {
        departmentBadge = 'System • Superadmin';
      } else {
        // Prioritize current task space, then origin space, then any authorized space, then primary space
        const targetSpaceId =
          (task?.spaceId && (u.spaceMemberships.some((m) => m.spaceId === task.spaceId) || u.headedSpaces.some((s) => s.id === task.spaceId)))
            ? task.spaceId
            : (task?.originSpaceId && (u.spaceMemberships.some((m) => m.spaceId === task.originSpaceId) || u.headedSpaces.some((s) => s.id === task.originSpaceId)))
              ? task.originSpaceId
              : Array.from(authorizedSpaceIds).find(
                (sid) =>
                  u.spaceMemberships.some((m) => m.spaceId === sid) ||
                  u.headedSpaces.some((s) => s.id === sid)
              );

        const headed = targetSpaceId
          ? u.headedSpaces.find((s) => s.id === targetSpaceId)
          : u.headedSpaces[0];

        const membership = targetSpaceId
          ? u.spaceMemberships.find((m) => m.spaceId === targetSpaceId)
          : u.spaceMemberships[0];

        if (headed) {
          departmentBadge = `${headed.name} • Lead`;
        } else if (membership) {
          const roleDisplay = membership.role === 'ADMIN' ? 'Admin' : 'Staff';
          departmentBadge = `${membership.space.name} • ${roleDisplay}`;
        } else if (u.headedSpaces[0]) {
          departmentBadge = `${u.headedSpaces[0].name} • Lead`;
        } else if (u.spaceMemberships[0]) {
          const roleDisplay = u.spaceMemberships[0].role === 'ADMIN' ? 'Admin' : 'Staff';
          departmentBadge = `${u.spaceMemberships[0].space.name} • ${roleDisplay}`;
        }
      }

      const primaryDept =
        u.headedSpaces[0]?.name ||
        u.spaceMemberships[0]?.space?.name ||
        (u.globalRole === 'SUPERADMIN' ? 'All Departments' : 'Staff');

      return {
        id: u.id,
        username: u.username,
        name: u.name,
        email: u.email,
        globalRole: u.globalRole,
        primaryDept,
        departmentBadge,
        isSpaceMember,
      };
    });

    // Sort: current space members first, then alphabetical
    const sortSpaceId = task?.spaceId || spaceId;
    if (sortSpaceId) {
      formatted.sort((a, b) => {
        if (a.isSpaceMember && !b.isSpaceMember) return -1;
        if (!a.isSpaceMember && b.isSpaceMember) return 1;
        return a.name.localeCompare(b.name);
      });
    }

    return NextResponse.json({ users: formatted });
  } catch (error) {
    console.error('Failed to fetch mentionable users:', error);
    return NextResponse.json(
      { error: 'Failed to fetch mentionable users.' },
      { status: 500 }
    );
  }
}
