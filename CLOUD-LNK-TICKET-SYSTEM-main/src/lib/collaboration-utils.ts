export interface TaskCollaborationInfo {
  isCollaborated: boolean;
  originSpace: { id: string; name: string; key: string } | null;
  currentSpace: { id: string; name: string; key: string };
  routeStr: string;
  participatingSpaceIds: string[];
  isOriginating?: boolean;
  isCurrentLocation?: boolean;
  isContributed?: boolean;
}

/**
 * Computes collaboration route, origin department, current location, and participating departments.
 * Pure computation function safe for both client and server usage.
 */
export function computeTaskCollaboration(
  task: {
    spaceId?: string;
    space?: { id: string; name: string; key: string } | null;
    history?: Array<{
      actionType?: string;
      fromSpaceId?: string | null;
      toSpaceId?: string | null;
      createdAt?: string | Date;
      fromSpace?: { id: string; name: string; key: string } | null;
      toSpace?: { id: string; name: string; key: string } | null;
      actor?: {
        id?: string;
        spaceMemberships?: Array<{ spaceId: string }>;
        headedSpaces?: Array<{ id: string }>;
      } | null;
    }>;
    contributors?: Array<{
      id?: string;
      spaceMemberships?: Array<{ spaceId: string }>;
      headedSpaces?: Array<{ id: string }>;
    }>;
    createdBy?: {
      id?: string;
      spaceMemberships?: Array<{ space?: { id: string; name: string; key: string }; spaceId?: string }>;
    } | null;
  },
  userSpaceIds?: string[]
): TaskCollaborationInfo {
  const currentSpace = task.space || { id: task.spaceId || '', name: 'Unknown', key: 'UNK' };

  // Filter valid cross-department handoff transfers
  const handoffs = (task.history || [])
    .filter(
      (h) =>
        h.actionType === 'HANDOFF_TRANSFER' &&
        h.fromSpaceId &&
        h.toSpaceId &&
        h.fromSpaceId !== h.toSpaceId
    )
    .sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeA - timeB;
    });

  const participatingSet = new Set<string>();
  if (currentSpace.id) participatingSet.add(currentSpace.id);

  // Determine Originating Space (Strict rule: only set if originSpace exists or handoff transfer occurred)
  let originSpace: { id: string; name: string; key: string } | null = null;
  if ((task as any).originSpace) {
    originSpace = (task as any).originSpace;
  } else if (handoffs.length > 0 && handoffs[0].fromSpace) {
    originSpace = handoffs[0].fromSpace;
  } else {
    originSpace = null;
  }

  if (originSpace?.id) {
    participatingSet.add(originSpace.id);
  }
  if ((task as any).originSpaceId) {
    participatingSet.add((task as any).originSpaceId);
  }

  // Trace Route Path
  let routeStr = '';
  if (handoffs.length > 0) {
    const routeNames: string[] = [];
    if (handoffs[0].fromSpace?.name) {
      routeNames.push(handoffs[0].fromSpace.name);
    }

    for (const h of handoffs) {
      if (h.fromSpaceId) participatingSet.add(h.fromSpaceId);
      if (h.toSpaceId) participatingSet.add(h.toSpaceId);

      if (h.toSpace?.name && routeNames[routeNames.length - 1] !== h.toSpace.name) {
        routeNames.push(h.toSpace.name);
      }
    }

    if (currentSpace.name && routeNames[routeNames.length - 1] !== currentSpace.name) {
      routeNames.push(currentSpace.name);
    }

    routeStr = routeNames.join(' → ');
  } else {
    routeStr = 'Contributed';
  }

  // Include Contributors' department spaces
  let hasForeignContributors = false;
  if (task.contributors && Array.isArray(task.contributors)) {
    for (const c of task.contributors) {
      if (c.spaceMemberships) {
        for (const sm of c.spaceMemberships) {
          if (sm.spaceId) {
            participatingSet.add(sm.spaceId);
            if (sm.spaceId !== currentSpace.id && sm.spaceId !== originSpace?.id) {
              hasForeignContributors = true;
            }
          }
        }
      }
      if (c.headedSpaces) {
        for (const ms of c.headedSpaces) {
          if (ms.id) {
            participatingSet.add(ms.id);
            if (ms.id !== currentSpace.id && ms.id !== originSpace?.id) {
              hasForeignContributors = true;
            }
          }
        }
      }
    }
  }

  // Include History Actors' department spaces
  if (task.history && Array.isArray(task.history)) {
    for (const h of task.history) {
      if (h.actor) {
        if (h.actor.spaceMemberships) {
          for (const sm of h.actor.spaceMemberships) {
            if (sm.spaceId) participatingSet.add(sm.spaceId);
          }
        }
        if (h.actor.headedSpaces) {
          for (const ms of h.actor.headedSpaces) {
            if (ms.id) participatingSet.add(ms.id);
          }
        }
      }
    }
  }

  // A ticket qualifies as collaborated if it has handoff transfer history across spaces,
  // staff from foreign departments contributed to it, or it originated in a different space.
  const hasOriginDivergence = Boolean(
    (task as any).originSpaceId && (task as any).originSpaceId !== currentSpace.id
  );
  const isCollaborated = handoffs.length > 0 || hasForeignContributors || hasOriginDivergence;

  const participatingSpaceIds = Array.from(participatingSet);

  const isOriginating = originSpace?.id && userSpaceIds ? userSpaceIds.includes(originSpace.id) : false;
  const isCurrentLocation = currentSpace.id && userSpaceIds ? userSpaceIds.includes(currentSpace.id) : false;
  const isContributed =
    (Array.isArray(task.contributors) &&
      task.contributors.some(
        (c) =>
          c.spaceMemberships?.some((sm) => userSpaceIds?.includes(sm.spaceId)) ||
          c.headedSpaces?.some((ms) => userSpaceIds?.includes(ms.id))
      )) || false;

  return {
    isCollaborated,
    originSpace,
    currentSpace,
    routeStr,
    participatingSpaceIds,
    isOriginating,
    isCurrentLocation,
    isContributed,
  };
}
