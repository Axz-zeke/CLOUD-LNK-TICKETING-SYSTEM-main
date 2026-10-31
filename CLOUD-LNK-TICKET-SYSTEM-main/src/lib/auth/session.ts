import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { prisma } from '../db';
import { AuthenticatedUser, ForbiddenError } from '../security/rbac';

import { getOrSetCache, invalidateCacheKey } from '../server-cache';

export const SESSION_COOKIE_NAME = 'lan_session_token';
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface SessionValidationResult {
  session: {
    id: string;
    token: string;
    expiresAt: Date;
  };
  user: AuthenticatedUser;
  assignedSpaceIds: string[];
}

/**
 * Creates a cryptographically secure 64-character random session token
 * and stores it in the database with an expiration date.
 */
export async function createSession(
  userId: string,
  db = prisma
): Promise<{ token: string; expiresAt: Date; id: string }> {
  // Generate 32 cryptographically secure random bytes = 64 hex characters
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  const session = await db.session.create({
    data: {
      token,
      userId,
      expiresAt,
    },
    select: {
      id: true,
      token: true,
      expiresAt: true,
    },
  });

  return session;
}

/**
 * Validates a session token with in-memory caching & deduplication (30s TTL):
 * - Checks expiration.
 * - Verifies user existence and isActive status.
 * - Returns user profile and assigned space IDs.
 */
export async function validateSession(
  token: string,
  db = prisma
): Promise<SessionValidationResult | null> {
  if (!token || typeof token !== 'string') {
    return null;
  }

  return getOrSetCache(
    `auth:session:${token}`,
    300_000, // 5 minutes fresh TTL
    async () => {
      const sessionRecord = await db.session.findUnique({
        where: { token },
        include: {
          user: {
            include: {
              spaceMemberships: {
                select: { spaceId: true },
              },
            },
          },
        },
      });

      if (!sessionRecord) {
        return null;
      }

      // Check expiration
      if (sessionRecord.expiresAt < new Date()) {
        db.session.delete({ where: { id: sessionRecord.id } }).catch(() => {});
        return null;
      }

      // Check if account has been deactivated
      if (!sessionRecord.user.isActive) {
        db.session.delete({ where: { id: sessionRecord.id } }).catch(() => {});
        return null;
      }

      return {
        session: {
          id: sessionRecord.id,
          token: sessionRecord.token,
          expiresAt: sessionRecord.expiresAt,
        },
        user: {
          id: sessionRecord.user.id,
          username: sessionRecord.user.username,
          email: sessionRecord.user.email,
          name: sessionRecord.user.name,
          globalRole: sessionRecord.user.globalRole,
          isActive: sessionRecord.user.isActive,
        },
        assignedSpaceIds: sessionRecord.user.spaceMemberships.map((m: { spaceId: string }) => m.spaceId),
      };
    },
    { swrMs: 600_000 } // 10 minutes stale-while-revalidate window
  );
}

/**
 * Invalidates (deletes) a session token from the database and clears its memory cache.
 */
export async function invalidateSession(token: string, db = prisma): Promise<boolean> {
  if (!token) return false;
  invalidateCacheKey(`auth:session:${token}`);
  try {
    await db.session.delete({ where: { token } });
    return true;
  } catch {
    return false;
  }
}

/**
 * Server-side helper to get the currently authenticated user from Next.js request cookies.
 */
export async function getCurrentUser(): Promise<SessionValidationResult | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!token) return null;
    return await validateSession(token);
  } catch {
    return null;
  }
}

/**
 * Asserts that the authenticated user has SUPERADMIN clearance.
 * Throws ForbiddenError (HTTP 403) if not.
 */
export function assertSuperadmin(user: AuthenticatedUser) {
  if (user.globalRole !== 'SUPERADMIN') {
    throw new ForbiddenError('HTTP 403 Forbidden: Superadmin clearance required.');
  }
}
