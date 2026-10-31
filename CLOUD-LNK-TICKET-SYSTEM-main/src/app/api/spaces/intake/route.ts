import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { getOrSetCache } from '@/lib/server-cache';

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

// GET /api/spaces/intake - Global destination intake spaces for any authenticated user
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user } = auth;
    const isSuperadmin = user.globalRole === 'SUPERADMIN';

    // Any authenticated user can target any active company space for intake (cached for fast modal open)
    const spaces = await getOrSetCache(
      'spaces:intake:all',
      60_000,
      () =>
        prisma.space.findMany({
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
                name: true,
                color: true,
                order: true,
                isCompleted: true,
                isClosed: true,
              },
            },
          },
          orderBy: { name: 'asc' },
        }),
      { swrMs: 180_000 }
    );

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
        lists: visibleLists,
        description: desc,
        color,
        icon,
      };
    });

    return NextResponse.json({
      spaces: mappedSpaces,
    });
  } catch (error) {
    console.error('Failed to fetch intake spaces:', error);
    return NextResponse.json(
      { error: 'An unexpected internal error occurred while fetching intake spaces.' },
      { status: 500 }
    );
  }
}
