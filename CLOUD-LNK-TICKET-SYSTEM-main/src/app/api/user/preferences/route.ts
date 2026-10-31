import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { getOrSetCache, invalidateCacheKey } from '@/lib/server-cache';

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

const DEFAULT_PREFERENCES = {
  theme: 'dark',
  boardDensity: 5,
  compactCards: false,
  enableSound: true,
  notifyOnAssign: true,
  notifyOnStatus: true,
  hasCompletedTour: false,
};

/**
 * GET /api/user/preferences
 * Returns personal workspace display & notification preferences for the logged-in user (cached 60s).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user } = auth;
    const prefData = await getOrSetCache(`prefs:${user.id}`, 60_000, async () => {
      const preference = await prisma.userPreference.findUnique({
        where: { userId: user.id },
      });

      if (!preference) {
        return {
          userId: user.id,
          ...DEFAULT_PREFERENCES,
        };
      }

      return {
        userId: preference.userId,
        theme: preference.theme ?? 'dark',
        boardDensity: preference.boardDensity,
        compactCards: preference.compactCards,
        enableSound: preference.enableSound,
        notifyOnAssign: preference.notifyOnAssign,
        notifyOnStatus: preference.notifyOnStatus,
        hasCompletedTour: preference.hasCompletedTour ?? false,
      };
    });

    return NextResponse.json({ preference: prefData });
  } catch (error) {
    console.error('Error fetching user preferences:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Internal server error while fetching user preferences.',
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/user/preferences
 * Updates personal workspace display & notification preferences for the logged-in user.
 */
export async function PATCH(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user } = auth;
    const body = await request.json().catch(() => ({}));
    const {
      theme,
      boardDensity,
      compactCards,
      enableSound,
      notifyOnAssign,
      notifyOnStatus,
      hasCompletedTour,
    } = body;

    const dataToUpdate: Record<string, any> = {};

    if (theme !== undefined) {
      const normalizedTheme = String(theme).toLowerCase().trim();
      if (['dark', 'light', 'system'].includes(normalizedTheme)) {
        dataToUpdate.theme = normalizedTheme;
      }
    }

    if (boardDensity !== undefined) {
      const parsedDensity = Number(boardDensity);
      if ([3, 4, 5, 6].includes(parsedDensity)) {
        dataToUpdate.boardDensity = parsedDensity;
      }
    }

    if (compactCards !== undefined) {
      dataToUpdate.compactCards = Boolean(compactCards);
    }

    if (enableSound !== undefined) {
      dataToUpdate.enableSound = Boolean(enableSound);
    }

    if (notifyOnAssign !== undefined) {
      dataToUpdate.notifyOnAssign = Boolean(notifyOnAssign);
    }

    if (notifyOnStatus !== undefined) {
      dataToUpdate.notifyOnStatus = Boolean(notifyOnStatus);
    }

    if (hasCompletedTour !== undefined) {
      dataToUpdate.hasCompletedTour = Boolean(hasCompletedTour);
    }

    const updated = await prisma.userPreference.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        theme: dataToUpdate.theme ?? DEFAULT_PREFERENCES.theme,
        boardDensity: dataToUpdate.boardDensity ?? DEFAULT_PREFERENCES.boardDensity,
        compactCards: dataToUpdate.compactCards ?? DEFAULT_PREFERENCES.compactCards,
        enableSound: dataToUpdate.enableSound ?? DEFAULT_PREFERENCES.enableSound,
        notifyOnAssign: dataToUpdate.notifyOnAssign ?? DEFAULT_PREFERENCES.notifyOnAssign,
        notifyOnStatus: dataToUpdate.notifyOnStatus ?? DEFAULT_PREFERENCES.notifyOnStatus,
        hasCompletedTour: dataToUpdate.hasCompletedTour ?? DEFAULT_PREFERENCES.hasCompletedTour,
      },
      update: dataToUpdate,
    });

    invalidateCacheKey(`prefs:${user.id}`);

    return NextResponse.json({
      preference: {
        userId: updated.userId,
        theme: updated.theme ?? 'dark',
        boardDensity: updated.boardDensity,
        compactCards: updated.compactCards,
        enableSound: updated.enableSound,
        notifyOnAssign: updated.notifyOnAssign,
        notifyOnStatus: updated.notifyOnStatus,
        hasCompletedTour: updated.hasCompletedTour ?? false,
      },
    });
  } catch (error) {
    console.error('Error updating user preferences:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Internal server error while updating user preferences.',
      },
      { status: 500 }
    );
  }
}
