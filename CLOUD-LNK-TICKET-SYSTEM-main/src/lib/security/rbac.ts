import { GlobalRole, SpaceRole, User } from '@prisma/client';
import { prisma } from '../db';

export { GlobalRole, SpaceRole };

export class ForbiddenError extends Error {
  public readonly statusCode = 403;
  public readonly code = 'FORBIDDEN';

  constructor(message = 'Access forbidden: Insufficient permissions for this resource.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class UnauthorizedError extends Error {
  public readonly statusCode = 401;
  public readonly code = 'UNAUTHORIZED';

  constructor(message = 'Authentication required.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export type AuthenticatedUser = {
  id: string;
  username: string;
  email: string;
  name: string;
  globalRole: GlobalRole;
  isActive: boolean;
};

import { getOrSetCache } from '../server-cache';

/**
 * Retrieves the space IDs a user has explicit membership in (cached 30s).
 */
export async function getUserAssignedSpaceIds(
  userId: string,
  db = prisma
): Promise<string[]> {
  return getOrSetCache(
    `user:spaces:${userId}`,
    300_000, // 5 minutes fresh TTL
    async () => {
      const [memberships, headedSpaces] = await Promise.all([
        db.spaceMember.findMany({
          where: { userId },
          select: { spaceId: true },
        }),
        db.space.findMany({
          where: { departmentHeadId: userId },
          select: { id: true },
        }),
      ]);

      const ids = new Set<string>();
      memberships.forEach((m: { spaceId: string }) => ids.add(m.spaceId));
      headedSpaces.forEach((s: { id: string }) => ids.add(s.id));
      return Array.from(ids);
    },
    { swrMs: 600_000 } // 10 minutes stale-while-revalidate window
  );
}

/**
 * Checks if a user has access clearance to a given Space.
 * - SUPERADMIN: Unrestricted global access to all spaces.
 * - ADMIN: Must have an explicit SpaceMember entry for this space.
 * - EMPLOYEE: General employees do not hold space membership.
 */
export async function canUserAccessSpace(
  user: AuthenticatedUser,
  spaceId: string,
  db = prisma
): Promise<boolean> {
  if (user.globalRole === 'SUPERADMIN') {
    return true;
  }

  const [membership, space] = await Promise.all([
    db.spaceMember.findUnique({
      where: {
        spaceId_userId: {
          spaceId,
          userId: user.id,
        },
      },
    }),
    db.space.findUnique({
      where: { id: spaceId },
      select: { departmentHeadId: true },
    }),
  ]);

  return Boolean(membership) || space?.departmentHeadId === user.id;
}

/**
 * Verifies if user has authority to manage user accounts and global permissions.
 */
export function canManageUsers(user: AuthenticatedUser): boolean {
  return user.globalRole === 'SUPERADMIN';
}

/**
 * Verifies if user has authority to assign/revoke space membership.
 */
export async function canManageSpaceMembers(
  user: AuthenticatedUser,
  spaceId: string,
  db = prisma
): Promise<boolean> {
  if (user.globalRole === 'SUPERADMIN') {
    return true;
  }

  if (user.globalRole === 'ADMIN') {
    const [membership, space] = await Promise.all([
      db.spaceMember.findUnique({
        where: {
          spaceId_userId: {
            spaceId,
            userId: user.id,
          },
        },
      }),
      db.space.findUnique({
        where: { id: spaceId },
        select: { departmentHeadId: true },
      }),
    ]);
    return membership?.role === SpaceRole.ADMIN || space?.departmentHeadId === user.id;
  }

  return false;
}
