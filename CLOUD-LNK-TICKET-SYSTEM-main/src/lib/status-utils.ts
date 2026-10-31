import { TaskStatusItem, StatusCategory } from '@/context/workspace-context';

export type { StatusCategory };

/**
 * Returns the underlying immutable/categorized lifecycle type for a status:
 * - CLOSED: closed/archived/cancelled states
 * - RESOLVED: completed/done/resolved states (SLA stops, requires handoff/resolution)
 * - OPEN: initial backlog/to-do state
 * - IN_PROGRESS: active work/review/investigation state
 */
export function getStatusCategory(status?: {
  id?: string;
  name?: string;
  isCompleted?: boolean;
  isClosed?: boolean;
  order?: number;
  type?: string | null;
  category?: string | null;
} | null): StatusCategory {
  if (!status) return 'OPEN';

  // Canonical status ID matching
  const statusId = (status.id || '').toLowerCase();
  if (statusId === 'st-open') return 'OPEN';
  if (statusId === 'st-prog') return 'IN_PROGRESS';
  if (statusId === 'st-pend') return 'PENDING_USER';
  if (statusId === 'st-reso') return 'RESOLVED';
  if (statusId === 'st-clos') return 'CLOSED';

  // Explicit type or category override if present
  const rawCat = (status.category || status.type || '').toUpperCase();
  if (rawCat === 'PENDING_USER' || rawCat === 'PENDING') return 'PENDING_USER';
  if (rawCat === 'RESOLVED') return 'RESOLVED';
  if (rawCat === 'CLOSED') return 'CLOSED';
  if (rawCat === 'OPEN') return 'OPEN';
  if (rawCat === 'IN_PROGRESS' || rawCat === 'IN PROGRESS') return 'IN_PROGRESS';

  const name = (status.name || '').toUpperCase().trim();
  if (name.includes('PENDING') || name.includes('WAITING') || name.includes('BLOCK') || name.includes('HOLD') || name.includes('REVIEW')) return 'PENDING_USER';
  if (name.includes('PROGRESS') || name.includes('WIP') || name.includes('DOING') || name.includes('ACTIVE') || name.includes('WORKING') || name.includes('PROCESSING') || name.includes('ONGOING')) return 'IN_PROGRESS';
  if (name.includes('RESOLV') || name.includes('DONE') || name.includes('FINISH') || name.includes('COMPLET')) return 'RESOLVED';
  if (name.includes('CLOSE') || name.includes('CANCEL') || name.includes('ARCHIVE')) return 'CLOSED';

  if (status.isClosed) return 'CLOSED';
  if (status.isCompleted) return 'RESOLVED';

  return 'OPEN';
}

/**
 * Universal Canonical Status Color Dictionary
 * Enforces one single standard across all spaces and views:
 * - OPEN: Blue #3B82F6
 * - IN_PROGRESS: Amber/Orange #F59E0B
 * - PENDING_USER / PENDING: Purple #8B5CF6
 * - RESOLVED: Emerald Green #10B981
 * - CLOSED: Slate Gray #6B7280
 */
export const CANONICAL_STATUS_COLORS: Record<StatusCategory, string> = {
  OPEN: '#3B82F6',
  IN_PROGRESS: '#F59E0B',
  PENDING_USER: '#8B5CF6',
  RESOLVED: '#10B981',
  CLOSED: '#6B7280',
};

/**
 * Deterministic helper that resolves any status object, category, or status identifier
 * to the exact platform-wide unified canonical hex color.
 */
export function getCanonicalStatusColor(
  statusOrCategory?:
    | StatusCategory
    | string
    | {
        id?: string;
        name?: string;
        color?: string;
        isCompleted?: boolean;
        isClosed?: boolean;
        category?: string | null;
        type?: string | null;
      }
    | null
): string {
  if (!statusOrCategory) return CANONICAL_STATUS_COLORS.OPEN;

  // 1. If passed a string (Category, ID, or Name)
  if (typeof statusOrCategory === 'string') {
    const upper = statusOrCategory.toUpperCase().trim();
    if (upper === 'OPEN') return CANONICAL_STATUS_COLORS.OPEN;
    if (upper === 'IN_PROGRESS' || upper === 'IN PROGRESS') return CANONICAL_STATUS_COLORS.IN_PROGRESS;
    if (upper === 'PENDING_USER' || upper === 'PENDING') return CANONICAL_STATUS_COLORS.PENDING_USER;
    if (upper === 'RESOLVED') return CANONICAL_STATUS_COLORS.RESOLVED;
    if (upper === 'CLOSED') return CANONICAL_STATUS_COLORS.CLOSED;

    const lower = statusOrCategory.toLowerCase().trim();
    if (lower === 'st-open') return CANONICAL_STATUS_COLORS.OPEN;
    if (lower === 'st-prog') return CANONICAL_STATUS_COLORS.IN_PROGRESS;
    if (lower === 'st-pend') return CANONICAL_STATUS_COLORS.PENDING_USER;
    if (lower === 'st-reso') return CANONICAL_STATUS_COLORS.RESOLVED;
    if (lower === 'st-clos') return CANONICAL_STATUS_COLORS.CLOSED;

    const cat = getStatusCategory({ name: statusOrCategory });
    return CANONICAL_STATUS_COLORS[cat] || CANONICAL_STATUS_COLORS.OPEN;
  }

  // 2. If passed a status object
  const cat = getStatusCategory(statusOrCategory);
  return CANONICAL_STATUS_COLORS[cat] || CANONICAL_STATUS_COLORS.OPEN;
}

export const CANONICAL_STATUSES: TaskStatusItem[] = [
  { id: 'st-open', name: 'Open', color: '#3B82F6', order: 0, isCompleted: false, isClosed: false, category: 'OPEN' },
  { id: 'st-prog', name: 'In Progress', color: '#F59E0B', order: 1, isCompleted: false, isClosed: false, category: 'IN_PROGRESS' },
  { id: 'st-pend', name: 'Pending', color: '#8B5CF6', order: 2, isCompleted: false, isClosed: false, category: 'PENDING_USER' },
  { id: 'st-reso', name: 'Resolved', color: '#10B981', order: 3, isCompleted: true, isClosed: false, category: 'RESOLVED' },
  { id: 'st-clos', name: 'Closed', color: '#6B7280', order: 4, isCompleted: true, isClosed: true, category: 'CLOSED' },
];

export function resolveCanonicalStatusName(statusIdOrName?: string | null): string {
  if (!statusIdOrName) return 'Open';
  const raw = statusIdOrName.toLowerCase().trim();
  if (raw === 'st-open' || /open|todo|triage|new|backlog/i.test(raw)) return 'Open';
  if (raw === 'st-prog' || /prog|doing|active|wip|in_progress|in progress/i.test(raw)) return 'In Progress';
  if (raw === 'st-pend' || /pend|wait|hold|review|approv|block/i.test(raw)) return 'Pending';
  if (raw === 'st-reso' || /resolv|done|solv|fix/i.test(raw)) return 'Resolved';
  if (raw === 'st-clos' || /clos|complet|cancel|finish|arch/i.test(raw)) return 'Closed';
  return 'Open';
}

export function getResolvedWorkflowStatuses(
  task: {
    spaceId?: string;
    space?: { statuses?: any[] } | null;
    statusId?: string;
    status?: any;
  } | null | undefined,
  spaces: Array<{ id: string; statuses?: any[] }> = []
): Array<{
  id: string;
  name: string;
  color: string;
  category: string;
  isCompleted: boolean;
  isClosed: boolean;
  order: number;
}> {
  const targetSpace = task?.spaceId ? spaces.find((s) => s.id === task.spaceId) : null;
  const rawStatuses: any[] = [
    ...(task?.space?.statuses || []),
    ...(targetSpace?.statuses || []),
  ];

  const findMatch = (matcher: (s: any) => boolean) => rawStatuses.find(matcher);

  const openMatch =
    findMatch((s) => !s.isCompleted && !s.isClosed && /open|todo|triage|new/i.test(s.name)) ||
    findMatch((s) => !s.isCompleted && !s.isClosed) ||
    findMatch((s) => s.id === 'st-open');

  const progMatch =
    findMatch((s) => /prog|active|doing|wip/i.test(s.name)) ||
    findMatch((s) => s.id === 'st-prog');

  const pendMatch =
    findMatch((s) => /pend|wait|hold|review|block/i.test(s.name)) ||
    findMatch((s) => s.id === 'st-pend');

  const resoMatch =
    findMatch((s) => s.isCompleted && !s.isClosed) ||
    findMatch((s) => /resolv|done|solv|fix/i.test(s.name)) ||
    findMatch((s) => s.id === 'st-reso');

  const closMatch =
    findMatch((s) => s.isClosed) ||
    findMatch((s) => /clos|cancel|finish|arch/i.test(s.name)) ||
    findMatch((s) => s.id === 'st-clos');

  const canonicalSlots = [
    openMatch
      ? { ...openMatch, category: 'OPEN', color: getCanonicalStatusColor(openMatch), order: openMatch.order ?? 0 }
      : { id: 'st-open', name: 'Open', color: '#3B82F6', category: 'OPEN', isCompleted: false, isClosed: false, order: 0 },
    progMatch
      ? { ...progMatch, category: 'IN_PROGRESS', color: getCanonicalStatusColor(progMatch), order: progMatch.order ?? 1 }
      : { id: 'st-prog', name: 'In Progress', color: '#F59E0B', category: 'IN_PROGRESS', isCompleted: false, isClosed: false, order: 1 },
    pendMatch
      ? { ...pendMatch, category: 'PENDING_USER', color: getCanonicalStatusColor(pendMatch), order: pendMatch.order ?? 2 }
      : { id: 'st-pend', name: 'Pending', color: '#8B5CF6', category: 'PENDING_USER', isCompleted: false, isClosed: false, order: 2 },
    resoMatch
      ? { ...resoMatch, category: 'RESOLVED', color: getCanonicalStatusColor(resoMatch), order: resoMatch.order ?? 3 }
      : { id: 'st-reso', name: 'Resolved', color: '#10B981', category: 'RESOLVED', isCompleted: true, isClosed: false, order: 3 },
    closMatch
      ? { ...closMatch, category: 'CLOSED', color: getCanonicalStatusColor(closMatch), order: closMatch.order ?? 4 }
      : { id: 'st-clos', name: 'Closed', color: '#6B7280', category: 'CLOSED', isCompleted: true, isClosed: true, order: 4 },
  ];

  const seenIds = new Set(canonicalSlots.map((s) => s.id));
  const extraStatuses: any[] = [];
  for (const st of rawStatuses) {
    if (st && st.id && !seenIds.has(st.id)) {
      seenIds.add(st.id);
      extraStatuses.push({
        ...st,
        category: getStatusCategory(st),
        color: getCanonicalStatusColor(st),
        order: st.order ?? canonicalSlots.length + extraStatuses.length,
      });
    }
  }

  if (task?.status && task.status.id && !seenIds.has(task.status.id)) {
    seenIds.add(task.status.id);
    extraStatuses.push({
      ...task.status,
      category: getStatusCategory(task.status),
      color: getCanonicalStatusColor(task.status),
      order: task.status.order ?? canonicalSlots.length + extraStatuses.length,
    });
  }

  return [...canonicalSlots, ...extraStatuses];
}

export function getMatchingStatusId(
  taskStatus: {
    id: string;
    name: string;
    isCompleted?: boolean;
    isClosed?: boolean;
    order?: number;
    category?: StatusCategory | string;
    type?: string | null;
  },
  availableStatuses: TaskStatusItem[]
): string | null {
  if (!availableStatuses || availableStatuses.length === 0) return null;

  // 1. Direct ID match
  const exact = availableStatuses.find((st) => st.id === taskStatus.id);
  if (exact) return exact.id;

  // 2. Exact Name match (case-insensitive)
  const nameMatch = availableStatuses.find(
    (st) => st.name.trim().toLowerCase() === taskStatus.name.trim().toLowerCase()
  );
  if (nameMatch) return nameMatch.id;

  // 3. Category match based on normalized getStatusCategory
  const taskCategory = getStatusCategory(taskStatus);
  const categoryMatch = availableStatuses.find((st) => getStatusCategory(st) === taskCategory);
  if (categoryMatch) return categoryMatch.id;

  // 4. Closed match
  if (taskStatus.isClosed) {
    const closedStatus = availableStatuses.find(
      (st) => st.isClosed || st.category === 'CLOSED' || st.id === 'st-clos' || /clos|cancel|archive/i.test(st.name)
    );
    if (closedStatus) return closedStatus.id;
  }

  // 5. Completed / Resolved match
  if (taskStatus.isCompleted) {
    const completedStatus = availableStatuses.find(
      (st) =>
        (st.isCompleted && !st.isClosed) ||
        st.category === 'RESOLVED' ||
        st.id === 'st-reso' ||
        /resolv|done|complet/i.test(st.name)
    );
    if (completedStatus) return completedStatus.id;
  }

  // 6. Semantic name matching for In Progress / Pending / Open
  const normName = taskStatus.name.toLowerCase();
  if (/pend|wait|review|block/i.test(normName)) {
    const pendStatus = availableStatuses.find(
      (st) => st.id === 'st-pend' || st.category === 'PENDING_USER' || /pend|wait|review|block/i.test(st.name)
    );
    if (pendStatus) return pendStatus.id;
  }

  if (/prog|wip|active|doing|investigat/i.test(normName)) {
    const progStatus = availableStatuses.find(
      (st) => st.id === 'st-prog' || st.category === 'IN_PROGRESS' || /prog|wip|active|doing/i.test(st.name)
    );
    if (progStatus) return progStatus.id;
  }

  if (/open|todo|to do|new|backlog/i.test(normName)) {
    const openStatus = availableStatuses.find(
      (st) => st.id === 'st-open' || st.category === 'OPEN' || /open|todo|to do|new|backlog/i.test(st.name)
    );
    if (openStatus) return openStatus.id;
  }

  // Fallback: match by status ID 'st-open' or first available
  return availableStatuses.find((st) => st.id === 'st-open')?.id || availableStatuses[0]?.id || null;
}

/**
 * Filter condition for Prisma task queries to count only active / open tickets
 * (excluding CLOSED, RESOLVED, and completed tickets).
 */
export const ACTIVE_TASK_STATUS_FILTER = {
  status: {
    isClosed: false,
    isCompleted: false,
    NOT: [
      {
        name: {
          in: [
            'Closed',
            'CLOSED',
            'closed',
            'Resolved',
            'RESOLVED',
            'resolved',
            'Done',
            'DONE',
            'done',
            'Completed',
            'COMPLETED',
            'completed',
            'Archived',
            'ARCHIVED',
            'archived',
            'Cancelled',
            'CANCELLED',
            'cancelled',
          ],
        },
      },
    ],
  },
};

/**
 * Filter condition for Prisma task queries to count strictly "Open" status tickets
 * (excluding In Progress, Pending, Resolved, and Closed tickets).
 */
export const OPEN_ONLY_TASK_STATUS_FILTER = {
  status: {
    isClosed: false,
    isCompleted: false,
    OR: [
      { id: 'st-open' },
      { name: { equals: 'Open', mode: 'insensitive' as const } },
      { order: 0 },
    ],
    NOT: [
      {
        name: {
          in: [
            'In Progress',
            'IN PROGRESS',
            'in progress',
            'IN_PROGRESS',
            'Pending',
            'PENDING',
            'pending',
            'PENDING_USER',
            'Closed',
            'CLOSED',
            'closed',
            'Resolved',
            'RESOLVED',
            'resolved',
            'Done',
            'DONE',
            'done',
            'Completed',
            'COMPLETED',
            'completed',
            'Archived',
            'ARCHIVED',
            'archived',
            'Cancelled',
            'CANCELLED',
            'cancelled',
          ],
        },
      },
    ],
  },
};

/**
 * Returns true if a given status represents an active / open ticket.
 */
export function isStatusActive(status?: {
  name?: string;
  isCompleted?: boolean;
  isClosed?: boolean;
  category?: StatusCategory | string;
} | null): boolean {
  if (!status) return true;
  if (status.isClosed || status.isCompleted) return false;
  if (status.category === 'CLOSED' || status.category === 'RESOLVED') return false;
  const name = (status.name || '').trim().toLowerCase();
  if (['closed', 'resolved', 'done', 'completed', 'archived', 'cancelled'].includes(name)) {
    return false;
  }
  return true;
}

