import type { AuthenticatedUser } from './rbac';

/**
 * Determines if an authenticated user holds staff clearance over a ticket's space.
 * Clearance requires:
 * - SUPERADMIN global role, OR
 * - User is assigned as department head or active member within that specific spaceId.
 */
export function hasTicketSpaceClearance(
  user?: AuthenticatedUser | null,
  ticketSpaceId?: string | null,
  userSpaces?: Array<{
    id: string;
    departmentHeadId?: string | null;
    members?: Array<{ userId: string }>;
  }> | null
): boolean {
  if (!user || !ticketSpaceId) return false;
  if (user.globalRole === 'SUPERADMIN') return true;
  if (!userSpaces || userSpaces.length === 0) return false;

  const space = userSpaces.find((s) => s.id === ticketSpaceId);
  if (!space) return false;

  if (space.departmentHeadId === user.id) return true;
  if (space.members && space.members.length > 0) {
    return space.members.some((m) => m.userId === user.id);
  }

  // If userSpaces was already filtered to user's assigned spaces from /api/spaces
  return true;
}

export function canModifyTicket(
  user?: AuthenticatedUser | null,
  task?: {
    spaceId?: string | null;
    space?: { id?: string | null } | null;
    originSpaceId?: string | null;
    createdById?: string | null;
    assigneeId?: string | null;
    assignee?: { id?: string | null } | null;
    contributors?: Array<{ id: string }> | null;
  } | null,
  userSpaces?: Array<{
    id: string;
    departmentHeadId?: string | null;
    members?: Array<{ userId: string }>;
  }> | null
): boolean {
  if (!user) return false;
  if (user.globalRole === 'SUPERADMIN') return true;
  if (!task) return false;

  // 1. Ticket Author / Creator Clearance
  if (task.createdById && task.createdById === user.id) return true;

  // 2. Ticket Assignee Clearance
  const assigneeId = task.assigneeId || task.assignee?.id;
  if (assigneeId && assigneeId === user.id) return true;

  // 3. Contributor Clearance
  if (task.contributors && Array.isArray(task.contributors) && task.contributors.some((c) => c.id === user.id)) {
    return true;
  }

  // 4. Destination Space Staff Clearance
  const spaceId = task.spaceId || task.space?.id;
  if (spaceId && hasTicketSpaceClearance(user, spaceId, userSpaces)) return true;

  // 5. Originating Department Staff Clearance (Cross-department collaboration)
  if (task.originSpaceId && hasTicketSpaceClearance(user, task.originSpaceId, userSpaces)) return true;

  return false;
}

/**
 * Helper to get user's role within a specific space.
 * Returns 'ADMIN', 'MEMBER', or null if not assigned.
 */
export function userSpaceRole(
  user?: AuthenticatedUser | null,
  spaceId?: string | null,
  userSpaces?: Array<{
    id: string;
    departmentHeadId?: string | null;
    members?: Array<{ userId: string; role?: string }>;
  }> | null
): string | null {
  if (!user || !spaceId) return null;
  if (user.globalRole === 'SUPERADMIN') return 'ADMIN';
  if (!userSpaces) return null;
  const space = userSpaces.find((s) => s.id === spaceId);
  if (!space) return null;
  if (space.departmentHeadId === user.id) return 'ADMIN';
  const member = space.members?.find((m) => m.userId === user.id);
  return member?.role || null;
}
