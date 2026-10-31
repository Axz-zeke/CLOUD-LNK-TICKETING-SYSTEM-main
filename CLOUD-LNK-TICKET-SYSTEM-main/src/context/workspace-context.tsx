'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  ReactNode,
} from 'react';
import { AuthenticatedUser } from '@/lib/security/rbac';
import { playNotificationChime } from '@/lib/audio';
import {
  updateClientCachedTask,
  prependClientCachedTask,
  removeClientCachedTask,
  invalidateClientSpacesCache,
  invalidateClientTasksCache,
} from '@/lib/client-cache';
import { toast } from '@/components/ui/toast';
import {
  CANONICAL_STATUSES,
  getStatusCategory,
  resolveCanonicalStatusName,
} from '@/lib/status-utils';

export type ViewMode = 'list' | 'board' | 'gantt' | 'dashboard';
export type FastViewId = 'everything' | 'assigned_to_me' | 'created_by_me' | 'collaborated' | 'assigned' | 'created' | 'all';

export type StatusCategory = 'OPEN' | 'IN_PROGRESS' | 'PENDING_USER' | 'RESOLVED' | 'CLOSED';

export interface TaskStatusItem {
  id: string;
  name: string;
  color: string;
  order: number;
  isCompleted: boolean;
  isClosed: boolean;
  category?: StatusCategory;
  type?: string;
  spaceId?: string;
}

export interface ListItem {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  order: number;
  isPrivate?: boolean;
  _count?: {
    tasks: number;
  };
}

export interface SpaceItem {
  id: string;
  name: string;
  key: string;
  description?: string | null;
  color?: string;
  icon?: string;
  departmentHeadId?: string | null;
  departmentHead?: {
    id: string;
    name: string;
    username: string;
    email: string;
  } | null;
  members?: Array<{
    userId: string;
    role: string;
  }>;
  lists: ListItem[];
  statuses: TaskStatusItem[];
  _count?: {
    tasks: number;
    members: number;
  };
}

export interface WorkspaceItem {
  id: string;
  name: string;
  slug: string;
}

export interface ActiveScope {
  type: 'fastView' | 'space' | 'list';
  fastViewId?: FastViewId;
  spaceId?: string;
  listId?: string;
}

export interface NotificationItem {
  id: string;
  userId: string;
  taskId?: string | null;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  task?: {
    id: string;
    taskKey: string;
    title: string;
  } | null;
}

export type RealTimeEventListener = (event: any) => void;

export interface WorkspaceContextType {
  workspace: WorkspaceItem | null;
  spaces: SpaceItem[];
  isLoading: boolean;
  activeScope: ActiveScope;
  activeView: ViewMode;
  isSidebarCollapsed: boolean;
  expandedSpaceIds: string[];
  createTicketModalOpen: boolean;
  createSpaceModalOpen: boolean;
  selectedTaskId: string | null;

  // Computed helpers
  currentSpace: SpaceItem | undefined;
  currentList: ListItem | undefined;
  currentTitle: string;

  // Actions
  selectFastView: (fastViewId: FastViewId) => void;
  selectSpace: (spaceId: string) => void;
  selectList: (spaceId: string, listId: string) => void;
  setActiveView: (view: ViewMode) => void;
  toggleSidebar: () => void;
  toggleSpaceExpanded: (spaceId: string) => void;
  expandSpace: (spaceId: string) => void;
  setCreateTicketModalOpen: (open: boolean) => void;
  setCreateSpaceModalOpen: (open: boolean) => void;
  setSelectedTaskId: (id: string | null) => void;
  refreshSpaces: () => Promise<void>;
  collaboratedCount: number;

  // Live Tasks & Real-Time Department/List Open Ticket Counts
  tasks: any[];
  hasLoadedTasks: boolean;
  spaceOpenCounts: Record<string, number>;
  listOpenCounts: Record<string, number>;
  syncWorkspaceTasks: (incomingTasks: any[], isFullDataset?: boolean) => void;
  optimisticAddTask: (newTask: any) => void;
  optimisticRemoveTask: (taskId: string) => void;

  // Real-Time Notification & LAN Event Stream Layer
  notifications: NotificationItem[];
  unreadCount: number;
  isSoundMuted: boolean;
  toggleSound: () => void;
  hasDesktopPermission: boolean;
  requestDesktopPermission: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  clearReadNotifications: () => Promise<void>;
  fetchNotifications: (options?: { delta?: boolean; forceFresh?: boolean }) => Promise<void>;
  subscribeToRealTimeEvents: (listener: RealTimeEventListener) => () => void;
  registerTasksRefresher: (refresher: (opts?: { silent?: boolean; forceFresh?: boolean }) => Promise<void>) => () => void;
  triggerTaskRefresh: (opts?: { silent?: boolean; forceFresh?: boolean }) => Promise<void>;

  // Mutation Lock & Optimistic State Engine (Prevents Rubber-Banding)
  isMutatingTasks: () => boolean;
  beginTaskMutation: () => void;
  endTaskMutation: () => void;
  applyPendingMutationsToTasks: <T extends { id: string }>(incomingTasks: T[]) => T[];
  optimisticUpdateTask: (taskId: string, updater: (task: any) => any) => void;
  registerOptimisticTaskUpdater: (updater: (taskId: string, updaterFn: (task: any) => any) => void) => () => void;
  updateTaskStatusOptimistic: (
    taskId: string,
    newStatusId: string,
    newStatus?: any
  ) => Promise<{ success: boolean; task?: any; error?: string }>;
  optimisticAddSpace: (newSpace: SpaceItem) => void;
  optimisticRemoveSpace: (spaceId: string) => void;
  optimisticAddList: (spaceId: string, newList: ListItem) => void;
  optimisticRemoveList: (spaceId: string, listId: string) => void;

  // Personal User Preferences & Settings Modal
  userPreferences: UserPreferencesState;
  isPreferencesLoaded: boolean;
  updateUserPreferences: (newPrefs: Partial<UserPreferencesState>) => Promise<void>;
  isSettingsModalOpen: boolean;
  setIsSettingsModalOpen: (open: boolean) => void;

  // Global Search Command Palette (Cmd+K / Ctrl+K)
  isSearchModalOpen: boolean;
  setIsSearchModalOpen: (open: boolean | ((prev: boolean) => boolean)) => void;

  // Onboarding Tour Layer
  isTourOpen: boolean;
  setIsTourOpen: (open: boolean) => void;
  startTour: () => void;
}

export interface UserPreferencesState {
  theme?: 'dark' | 'light' | 'system';
  boardDensity: number;
  compactCards: boolean;
  enableSound: boolean;
  notifyOnAssign: boolean;
  notifyOnStatus: boolean;
  hasCompletedTour: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

function isTaskStrictlyOpen(task: any): boolean {
  if (!task) return false;
  if (task.status?.isCompleted || task.status?.isClosed) return false;
  const statusObj =
    task.status || (task.statusId ? { id: task.statusId, name: task.statusId } : null);
  const cat = getStatusCategory(statusObj);
  if (cat !== 'OPEN') return false;
  return (
    cat === 'OPEN' ||
    task.status?.id === 'st-open' ||
    task.statusId === 'st-open' ||
    task.status?.name?.trim().toLowerCase() === 'open'
  );
}

export function WorkspaceProvider({
  children,
  user,
}: {
  children: ReactNode;
  user?: AuthenticatedUser;
}) {
  const [workspace, setWorkspace] = useState<WorkspaceItem | null>(null);
  const [spaces, setSpaces] = useState<SpaceItem[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [hasLoadedTasks, setHasLoadedTasks] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // Default active scope: "everything" across all roles
  const [activeScope, setActiveScope] = useState<ActiveScope>({
    type: 'fastView',
    fastViewId: 'everything',
  });

  const [activeView, setActiveView] = useState<ViewMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('workspace_view_mode');
      if (saved === 'list' || saved === 'board' || saved === 'gantt' || saved === 'dashboard') return saved;
    }
    return 'board'; // Default to Board (Kanban)
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [expandedSpaceIds, setExpandedSpaceIds] = useState<string[]>([]);
  const [createTicketModalOpen, setCreateTicketModalOpenState] = useState(false);
  const [createSpaceModalOpen, setCreateSpaceModalOpenState] = useState(false);
  const [collaboratedCount, setCollaboratedCount] = useState<number>(0);

  // Notifications & Real-Time Sync State
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isSoundMuted, setIsSoundMuted] = useState(false);
  const [hasDesktopPermission, setHasDesktopPermission] = useState(false);

  // User Preferences & Settings Modal State
  const [userPreferences, setUserPreferences] = useState<UserPreferencesState>({
    theme: 'dark',
    boardDensity: 5,
    compactCards: false,
    enableSound: true,
    notifyOnAssign: true,
    notifyOnStatus: true,
    hasCompletedTour: false,
  });
  const [isPreferencesLoaded, setIsPreferencesLoaded] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isTourOpen, setIsTourOpen] = useState(false);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);

  // Task refresher callback registry for silent background refreshes
  const taskRefresherRef = useRef<((opts?: { silent?: boolean; forceFresh?: boolean }) => Promise<void>) | null>(null);

  const registerTasksRefresher = useCallback((refresher: (opts?: { silent?: boolean; forceFresh?: boolean }) => Promise<void>) => {
    taskRefresherRef.current = refresher;
    return () => {
      if (taskRefresherRef.current === refresher) {
        taskRefresherRef.current = null;
      }
    };
  }, []);

  const triggerTaskRefresh = useCallback(async (opts: { silent?: boolean; forceFresh?: boolean } = { silent: true }) => {
    if (taskRefresherRef.current) {
      try {
        await taskRefresherRef.current(opts);
      } catch (e) {
        console.error('Failed to trigger task refresh:', e);
      }
    }
  }, []);

  // Per-task optimistic version lock: prevents delayed server polls from snapping recently moved cards back
  const pendingTaskMutationsRef = useRef<
    Map<string, { statusId: string; status: any; timestamp: number; confirmed?: boolean }>
  >(new Map());

  const applyPendingMutationsToTasks = useCallback(<T extends { id: string }>(incomingTasks: T[]): T[] => {
    if (!Array.isArray(incomingTasks) || pendingTaskMutationsRef.current.size === 0) {
      return incomingTasks;
    }
    const now = Date.now();
    return incomingTasks.map((t: any) => {
      if (!t?.id) return t;
      const pending = pendingTaskMutationsRef.current.get(t.id);
      if (!pending) return t;

      // Expire entries older than 5 seconds
      if (now - pending.timestamp > 5000) {
        pendingTaskMutationsRef.current.delete(t.id);
        return t;
      }

      const incomingCategory = getStatusCategory(
        t.status || { id: t.statusId, name: t.statusId || '' }
      );
      const pendingCategory =
        pending.status?.category ||
        getStatusCategory(pending.status || { id: pending.statusId, name: pending.statusId || '' });

      const serverConfirmedStatus =
        t.statusId === pending.statusId ||
        (t.status?.id && t.status.id === pending.statusId) ||
        (Boolean(pendingCategory) && incomingCategory === pendingCategory);

      if (serverConfirmedStatus && pending.confirmed) {
        pendingTaskMutationsRef.current.delete(t.id);
        return t;
      }

      // Keep optimistic statusId and status so stale polls never snap card back
      return {
        ...t,
        statusId: pending.statusId,
        status: {
          ...t.status,
          ...pending.status,
        },
      };
    });
  }, []);

  // Synchronize live tasks into workspace context for 0ms sidebar open-ticket count computation
  const syncWorkspaceTasks = useCallback((incomingTasks: any[], isFullDataset = false) => {
    if (!Array.isArray(incomingTasks)) return;
    const guardedIncoming = applyPendingMutationsToTasks(incomingTasks);
    setTasks((prev) => {
      if (isFullDataset || prev.length === 0) {
        return guardedIncoming;
      }
      const incomingMap = new Map(guardedIncoming.map((t) => [t.id, t]));
      const merged = prev.map((t) =>
        incomingMap.has(t.id) ? { ...t, ...incomingMap.get(t.id) } : t
      );
      const existingIds = new Set(prev.map((t) => t.id));
      for (const item of guardedIncoming) {
        if (item?.id && !existingIds.has(item.id)) {
          merged.unshift(item);
        }
      }
      return merged;
    });
    if (isFullDataset) {
      setHasLoadedTasks(true);
    }
  }, [applyPendingMutationsToTasks]);

  const optimisticAddTask = useCallback((newTask: any) => {
    if (!newTask?.id) return;
    prependClientCachedTask(newTask);
    setTasks((prev) => [newTask, ...prev.filter((t) => t.id !== newTask.id)]);
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        const bc = new BroadcastChannel('ticket_system_realtime');
        bc.postMessage({ type: 'TASK_CREATED', task: newTask });
        bc.close();
      } catch {}
    }
  }, []);

  const optimisticRemoveTask = useCallback((taskId: string) => {
    if (!taskId) return;
    pendingTaskMutationsRef.current.delete(taskId);
    removeClientCachedTask(taskId);
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        const bc = new BroadcastChannel('ticket_system_realtime');
        bc.postMessage({ type: 'TASK_DELETED', taskId });
        bc.close();
      } catch {}
    }
  }, []);

  // Mutation lock counter: while activeMutationsRef.current > 0, background polling is paused to prevent rubber-banding
  const activeMutationsRef = useRef<number>(0);
  const isMutatingTasks = useCallback(() => activeMutationsRef.current > 0, []);
  const beginTaskMutation = useCallback(() => {
    activeMutationsRef.current += 1;
  }, []);
  const endTaskMutation = useCallback(() => {
    activeMutationsRef.current = Math.max(0, activeMutationsRef.current - 1);
  }, []);

  // Optimistic task update registry
  const taskUpdatersRef = useRef<Set<(taskId: string, updater: (task: any) => any) => void>>(new Set());

  const registerOptimisticTaskUpdater = useCallback(
    (updater: (taskId: string, updaterFn: (task: any) => any) => void) => {
      taskUpdatersRef.current.add(updater);
      return () => {
        taskUpdatersRef.current.delete(updater);
      };
    },
    []
  );

  const optimisticUpdateTask = useCallback((taskId: string, updater: (task: any) => any) => {
    // 1. Update client cache immediately in-place
    updateClientCachedTask(taskId, updater);

    // 2. Update live tasks in WorkspaceContext immediately in 0ms (drives Sidebar Space/List open counts)
    setTasks((prev) => prev.map((t) => (t.id === taskId ? updater(t) : t)));

    // 3. Run all registered React state updaters (e.g. AppShell active view)
    taskUpdatersRef.current.forEach((fn) => {
      try {
        fn(taskId, updater);
      } catch (err) {
        console.error('Optimistic updater failed:', err);
      }
    });
  }, []);

  /**
   * Unified 0ms Optimistic Status Handler across all views (Board, List, Gantt, Drawer)
   * 1. Records per-task optimistic version lock in pendingTaskMutationsRef.
   * 2. Updates local React tasks state instantly in 0ms.
   * 3. Locks background polling counter (activeMutationsRef.current++) during PATCH + 3s post-settlement guard.
   * 4. Dispatches PATCH /api/tasks/${taskId} in the background.
   * 5. Merges authoritative server response or gracefully rolls back on failure with toast.
   */
  const updateTaskStatusOptimistic = useCallback(
    async (taskId: string, newStatusId: string, newStatus?: any) => {
      if (!taskId || !newStatusId) return { success: false, error: 'Invalid parameters' };

      // 1. Resolve target status object accurately across passed newStatus, spaces, and canonical
      let targetStatusObj: TaskStatusItem | undefined = newStatus;

      if (!targetStatusObj || !targetStatusObj.name) {
        for (const sp of spaces) {
          const st = sp.statuses?.find((s) => s.id === newStatusId);
          if (st) {
            targetStatusObj = st;
            break;
          }
        }
      }

      // If newStatusId is canonical (e.g. st-pend, st-reso, etc.)
      if (!targetStatusObj || !targetStatusObj.name) {
        targetStatusObj = CANONICAL_STATUSES.find((s) => s.id === newStatusId);
      }

      if (!targetStatusObj || !targetStatusObj.name) {
        const canonicalName = resolveCanonicalStatusName(newStatusId);
        const canonicalMatch = CANONICAL_STATUSES.find(
          (s) => s.id === newStatusId || s.name.toLowerCase() === canonicalName.toLowerCase()
        );
        targetStatusObj = canonicalMatch || {
          id: newStatusId,
          name: canonicalName,
          color: '#3B82F6',
          order: 0,
          isCompleted: false,
          isClosed: false,
          category: 'OPEN',
        };
      }

      const targetCategory = targetStatusObj.category || getStatusCategory(targetStatusObj);
      const isClosing = Boolean(
        targetStatusObj.isCompleted ||
        targetStatusObj.isClosed ||
        targetCategory === 'RESOLVED' ||
        targetCategory === 'CLOSED'
      );

      const resolvedOptimisticStatus = {
        ...targetStatusObj,
        id: targetStatusObj.id,
        name: targetStatusObj.name,
        color: targetStatusObj.color || '#3B82F6',
        order: targetStatusObj.order ?? 0,
        isCompleted: Boolean(targetStatusObj.isCompleted),
        isClosed: Boolean(targetStatusObj.isClosed),
        category: targetCategory,
      };

      // 2. Record per-task optimistic lock & increment global polling lock
      const mutationTimestamp = Date.now();
      pendingTaskMutationsRef.current.set(taskId, {
        statusId: resolvedOptimisticStatus.id,
        status: resolvedOptimisticStatus,
        timestamp: mutationTimestamp,
        confirmed: false,
      });
      beginTaskMutation();
      let didSucceed = false;

      // 3. Immediately update task in local React tasks state & client cache (0ms UI response)
      let previousTaskSnapshot: any = null;

      const optimisticUpdater = (task: any) => {
        if (!task || task.id !== taskId) return task;
        if (!previousTaskSnapshot) {
          previousTaskSnapshot = { ...task };
        }
        return {
          ...task,
          statusId: resolvedOptimisticStatus.id,
          status: {
            ...task.status,
            ...resolvedOptimisticStatus,
          },
          completedAt: isClosing ? (task.completedAt || new Date().toISOString()) : null,
        };
      };

      optimisticUpdateTask(taskId, optimisticUpdater);

      // 4. Send PATCH /api/tasks/${taskId} in the background
      try {
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ statusId: resolvedOptimisticStatus.id }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const errMsg =
            errData.error ||
            (res.status === 403
              ? 'Permission Denied: Only department staff, assignees, or creators can modify this ticket.'
              : 'Failed to update ticket status.');

          // Clear pending lock & roll back the optimistic state
          pendingTaskMutationsRef.current.delete(taskId);
          if (previousTaskSnapshot) {
            optimisticUpdateTask(taskId, () => previousTaskSnapshot);
          }
          toast.error(errMsg, res.status === 403 ? 'Clearance Denied' : 'Update Failed');
          return { success: false, error: errMsg };
        }

        const data = await res.json();
        const authoritativeTask = data.task;
        didSucceed = true;

        const confirmedStatus = authoritativeTask?.status || resolvedOptimisticStatus;
        const confirmedStatusId = authoritativeTask?.statusId || confirmedStatus.id;
        const settledAt = Date.now();

        pendingTaskMutationsRef.current.set(taskId, {
          statusId: confirmedStatusId,
          status: confirmedStatus,
          timestamp: settledAt,
          confirmed: true,
        });

        setTimeout(() => {
          const cur = pendingTaskMutationsRef.current.get(taskId);
          if (cur && cur.timestamp === settledAt) {
            pendingTaskMutationsRef.current.delete(taskId);
          }
        }, 5000);

        if (authoritativeTask) {
          optimisticUpdateTask(taskId, (t: any) =>
            t.id === taskId ? { ...t, ...authoritativeTask } : t
          );
        }

        // Cross-tab broadcast for instant sync across tabs and windows
        if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
          try {
            const bc = new BroadcastChannel('ticket_system_realtime');
            bc.postMessage({
              type: 'TASK_MUTATED',
              taskId,
              newStatusId: confirmedStatusId,
              task: authoritativeTask,
            });
            bc.close();
          } catch {}
        }

        return { success: true, task: authoritativeTask };
      } catch (netErr: any) {
        console.error('Network error during optimistic status update:', netErr);
        pendingTaskMutationsRef.current.delete(taskId);
        if (previousTaskSnapshot) {
          optimisticUpdateTask(taskId, () => previousTaskSnapshot);
        }
        toast.error(netErr?.message || 'Network error updating ticket status.', 'Network Error');
        return { success: false, error: netErr?.message || 'Network error' };
      } finally {
        if (didSucceed) {
          // Hold polling lock for 3 seconds after PATCH resolves so stale cross-instance reads cannot rubber-band
          setTimeout(() => {
            endTaskMutation();
          }, 3000);
        } else {
          endTaskMutation();
        }
      }
    },
    [spaces, beginTaskMutation, endTaskMutation, optimisticUpdateTask]
  );

  // Optimistic Space additions for 0ms sidebar display and auto-expansion
  const optimisticAddSpace = useCallback((newSpace: SpaceItem) => {
    invalidateClientSpacesCache();
    setSpaces((prev) => {
      const exists = prev.some((s) => s.id === newSpace.id);
      if (exists) {
        return prev.map((s) => (s.id === newSpace.id ? { ...s, ...newSpace } : s));
      }
      return [...prev, newSpace];
    });
    setExpandedSpaceIds((prev) => (prev.includes(newSpace.id) ? prev : [...prev, newSpace.id]));
  }, []);

  // Instant optimistic Space removal for 0ms sidebar removal
  const optimisticRemoveSpace = useCallback((spaceId: string) => {
    // 1. Immediately remove from React spaces state (0ms UI update)
    setSpaces((prev) => prev.filter((s) => s.id !== spaceId));
    // 2. Remove from expanded space IDs
    setExpandedSpaceIds((prev) => prev.filter((id) => id !== spaceId));
    // 3. Clear client caches
    invalidateClientSpacesCache();
    invalidateClientTasksCache();
    // 4. Trigger tasks refresh to purge tasks belonging to deleted space
    triggerTaskRefresh({ silent: true });
    // 5. If active scope is within the deleted space, redirect to 'everything' fast view
    setActiveScope((prev) => {
      if (prev.spaceId === spaceId) {
        return { type: 'fastView', fastViewId: 'everything' };
      }
      return prev;
    });
  }, [triggerTaskRefresh]);

  // Optimistic Queue List additions/removals for 0ms sidebar updates
  const optimisticAddList = useCallback((spaceId: string, newList: ListItem) => {
    setSpaces((prev) =>
      prev.map((s) => {
        if (s.id !== spaceId) return s;
        const exists = s.lists?.some(
          (l) => l.id === newList.id || l.name.toLowerCase() === newList.name.toLowerCase()
        );
        if (exists) {
          return {
            ...s,
            lists: s.lists.map((l) =>
              l.id === newList.id || l.name.toLowerCase() === newList.name.toLowerCase()
                ? { ...l, ...newList }
                : l
            ),
          };
        }
        return {
          ...s,
          lists: [...(s.lists || []), newList],
        };
      })
    );
  }, []);

  const optimisticRemoveList = useCallback((spaceId: string, listId: string) => {
    setSpaces((prev) =>
      prev.map((s) => {
        if (s.id !== spaceId) return s;
        return {
          ...s,
          lists: (s.lists || []).filter((l) => l.id !== listId),
        };
      })
    );
  }, []);

  // Global keydown listener for Cmd+K (macOS) and Ctrl+K (Windows/Linux)
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchModalOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const startTour = useCallback(() => {
    setIsTourOpen(true);
  }, []);

  // Sync user preferences with backend
  useEffect(() => {
    if (!user) return;
    fetch('/api/user/preferences')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.preference) {
          setUserPreferences(data.preference);
          setIsSoundMuted(!data.preference.enableSound);

          if (data.preference.theme && typeof window !== 'undefined') {
            const currentSaved = localStorage.getItem('theme');
            if (!currentSaved) {
              try {
                localStorage.setItem('theme', data.preference.theme);
              } catch {}
              const isDark = data.preference.theme !== 'light';
              if (isDark) {
                document.documentElement.classList.add('dark');
              } else {
                document.documentElement.classList.remove('dark');
              }
            }
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        setIsPreferencesLoaded(true);
      });
  }, [user]);

  const updateUserPreferences = useCallback(
    async (newPrefs: Partial<UserPreferencesState>) => {
      setUserPreferences((prev) => ({ ...prev, ...newPrefs }));

      if (newPrefs.enableSound !== undefined) {
        setIsSoundMuted(!newPrefs.enableSound);
        try {
          localStorage.setItem('ticket_sys_sound_muted', String(!newPrefs.enableSound));
        } catch {}
      }

      if (newPrefs.theme !== undefined && typeof window !== 'undefined') {
        try {
          localStorage.setItem('theme', newPrefs.theme);
        } catch {}
        const isDark = newPrefs.theme !== 'light';
        if (isDark) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      }

      try {
        const res = await fetch('/api/user/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newPrefs),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.preference) {
            setUserPreferences(data.preference);
          }
        }
      } catch (err) {
        console.error('Failed to persist user preferences:', err);
      }
    },
    []
  );

  const isSoundMutedRef = useRef(isSoundMuted);
  useEffect(() => {
    isSoundMutedRef.current = isSoundMuted;
  }, [isSoundMuted]);

  const selectedTaskIdRef = useRef(selectedTaskId);
  useEffect(() => {
    selectedTaskIdRef.current = selectedTaskId;
  }, [selectedTaskId]);

  const listenersRef = useRef<Set<RealTimeEventListener>>(new Set());

  const subscribeToRealTimeEvents = useCallback((listener: RealTimeEventListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  // Restore sidebar state and sound preference from localStorage on client mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('clickup_sidebar_collapsed');
      if (saved === 'true') {
        setIsSidebarCollapsed(true);
      }
      const savedMute = localStorage.getItem('ticket_sys_sound_muted');
      if (savedMute === 'true') {
        setIsSoundMuted(true);
      }
      if (typeof window !== 'undefined' && 'Notification' in window) {
        setHasDesktopPermission(Notification.permission === 'granted');
      }
    } catch {
      // Ignore localStorage errors in restricted environments
    }
  }, []);

  const refreshSpaces = useCallback(async () => {
    try {
      const res = await fetch(`/api/spaces?fresh=1&_t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setWorkspace(data.workspace);
        const fetchedSpaces: SpaceItem[] = data.spaces || [];
        setSpaces(fetchedSpaces);
        if (typeof data.collaboratedCount === 'number') {
          setCollaboratedCount(data.collaboratedCount);
        }

        // Expand all spaces by default on initial load
        setExpandedSpaceIds((prev) => {
          if (prev.length === 0) {
            return fetchedSpaces.map((s) => s.id);
          }
          return prev;
        });
      }
    } catch (err) {
      console.error('Failed to load workspace spaces:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshMasterWorkspaceTasks = useCallback(async () => {
    if (!user || isMutatingTasks()) return;
    try {
      const res = await fetch(`/api/tasks?fastView=everything&fresh=1&_t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.tasks) && !isMutatingTasks()) {
          setTasks(applyPendingMutationsToTasks(data.tasks));
          setHasLoadedTasks(true);
        }
      }
    } catch {
      // Quiet background failure
    }
  }, [user, isMutatingTasks, applyPendingMutationsToTasks]);

  useEffect(() => {
    refreshSpaces();
    refreshMasterWorkspaceTasks();
  }, [refreshSpaces, refreshMasterWorkspaceTasks]);

  // Sidebar toggle with localStorage persistence
  const toggleSidebar = useCallback(() => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('clickup_sidebar_collapsed', String(next));
      } catch {}
      return next;
    });
  }, []);

  // Expand / Collapse Space in sidebar navigation
  const toggleSpaceExpanded = useCallback((spaceId: string) => {
    setExpandedSpaceIds((prev) =>
      prev.includes(spaceId)
        ? prev.filter((id) => id !== spaceId)
        : [...prev, spaceId]
    );
  }, []);

  // Ensure a space is expanded in sidebar
  const expandSpace = useCallback((spaceId: string) => {
    setExpandedSpaceIds((prev) => (prev.includes(spaceId) ? prev : [...prev, spaceId]));
  }, []);

  const selectFastView = useCallback((fastViewId: FastViewId) => {
    setActiveScope({ type: 'fastView', fastViewId });
  }, []);

  const selectSpace = useCallback((spaceId: string) => {
    setActiveScope({ type: 'space', spaceId });
  }, []);

  const selectList = useCallback((spaceId: string, listId: string) => {
    setActiveScope({ type: 'list', spaceId, listId });
  }, []);

  const setCreateTicketModalOpen = useCallback((open: boolean) => {
    setCreateTicketModalOpenState(open);
  }, []);

  const setCreateSpaceModalOpen = useCallback((open: boolean) => {
    setCreateSpaceModalOpenState(open);
  }, []);

  const handleSetActiveView = useCallback((view: ViewMode) => {
    setActiveView(view);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('workspace_view_mode', view);
      } catch {}
    }
  }, []);

  // Notification action handlers & Serverless-Compatible Delta Sync Heartbeat
  const previousUnreadCountRef = useRef<number | null>(null);
  const seenNotificationIdsRef = useRef<Set<string>>(new Set());
  const hasHydratedNotificationsRef = useRef(false);
  const lastTaskDeltaStampRef = useRef<{ updatedAtMs: number | null; count: number } | null>(null);
  const notificationsRef = useRef<NotificationItem[]>([]);
  notificationsRef.current = notifications;

  const fetchNotifications = useCallback(async (options?: { delta?: boolean; forceFresh?: boolean }) => {
    const isDelta = options?.delta === true;
    const url = isDelta
      ? `/api/notifications?delta=1&_t=${Date.now()}`
      : `/api/notifications?_t=${Date.now()}${options?.forceFresh ? '&fresh=1' : ''}`;

    try {
      const res = await fetch(url, {
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        const incomingNotifs: NotificationItem[] = Array.isArray(data.notifications) ? data.notifications : [];
        const newUnread = typeof data.unreadCount === 'number' ? data.unreadCount : 0;

        // Detect newly arrived unread notifications across isolated Vercel serverless instances
        if (hasHydratedNotificationsRef.current && incomingNotifs.length > 0) {
          const brandNewUnread = incomingNotifs.filter(
            (n) => !n.isRead && !seenNotificationIdsRef.current.has(n.id)
          );
          if (brandNewUnread.length > 0) {
            if (!isSoundMutedRef.current) {
              playNotificationChime();
            }
            const newest = brandNewUnread[0];
            toast.info(newest.message, newest.title);
          }
        }

        for (const n of incomingNotifs) {
          seenNotificationIdsRef.current.add(n.id);
        }

        // Normalize timestamp to numeric epoch milliseconds to eliminate ISO string formatting false positives
        const rawTaskUpdatedAt = data.latestTaskUpdatedAt ?? null;
        const latestTaskUpdatedAtMs = rawTaskUpdatedAt ? new Date(rawTaskUpdatedAt).getTime() : 0;
        const totalTaskCount =
          typeof data.totalTaskCount === 'number' ? data.totalTaskCount : -1;

        // Seeding phase: On initial hydration, seed the baseline refs without firing false-positive refreshes!
        if (!hasHydratedNotificationsRef.current || lastTaskDeltaStampRef.current === null) {
          hasHydratedNotificationsRef.current = true;
          previousUnreadCountRef.current = newUnread;
          if (totalTaskCount >= 0) {
            lastTaskDeltaStampRef.current = {
              updatedAtMs: latestTaskUpdatedAtMs,
              count: totalTaskCount,
            };
          }
          setUnreadCount((prev) => (prev === newUnread ? prev : newUnread));
          if (!isDelta || incomingNotifs.length > 0) {
            setNotifications(incomingNotifs);
            notificationsRef.current = incomingNotifs;
          }
          if (isDelta && incomingNotifs.length === 0 && newUnread > 0) {
            fetchNotifications({ delta: false, forceFresh: true });
          }
          return;
        }

        // Compare strictly numeric epoch milliseconds and counts
        const prevStamp = lastTaskDeltaStampRef.current;
        const hasTaskDeltaChanged =
          prevStamp !== null &&
          totalTaskCount >= 0 &&
          (prevStamp.updatedAtMs !== latestTaskUpdatedAtMs ||
            prevStamp.count !== totalTaskCount);

        const hasNewUnreadArrived =
          previousUnreadCountRef.current !== null &&
          newUnread > previousUnreadCountRef.current;

        if (totalTaskCount >= 0) {
          lastTaskDeltaStampRef.current = {
            updatedAtMs: latestTaskUpdatedAtMs,
            count: totalTaskCount,
          };
        }

        if (hasNewUnreadArrived || hasTaskDeltaChanged) {
          if (!isMutatingTasks()) {
            invalidateClientTasksCache();
            invalidateClientSpacesCache();
            triggerTaskRefresh({ silent: true, forceFresh: true });
            refreshMasterWorkspaceTasks();
            refreshSpaces();
          }
        }
        previousUnreadCountRef.current = newUnread;

        // Never overwrite notifications with [] during a delta=1 poll
        if (!isDelta) {
          setNotifications((prev) => {
            if (
              prev.length === incomingNotifs.length &&
              prev.every(
                (item, idx) =>
                  item.id === incomingNotifs[idx]?.id &&
                  item.isRead === incomingNotifs[idx]?.isRead
              )
            ) {
              return prev;
            }
            return incomingNotifs;
          });
          notificationsRef.current = incomingNotifs;
        } else {
          // If delta poll returns with unread notifications while list is empty,
          // or if the latestNotificationId differs from our topmost notification,
          // immediately trigger a full non-delta fetch!
          const latestNotifId = data.latestNotificationId || null;
          const currentFirstId = notificationsRef.current[0]?.id || null;
          const needsFullFetch =
            (notificationsRef.current.length === 0 && newUnread > 0) ||
            (latestNotifId !== null && latestNotifId !== currentFirstId);

          if (needsFullFetch) {
            fetchNotifications({ delta: false, forceFresh: true });
          }
        }

        setUnreadCount((prev) => (prev === newUnread ? prev : newUnread));
      }
    } catch {
      // Quiet fail in background
    }
  }, [triggerTaskRefresh, refreshMasterWorkspaceTasks, refreshSpaces, isMutatingTasks]);

  const markNotificationRead = useCallback(async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
    try {
      await fetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
    } catch (err) {
      console.error('Failed to mark notification read:', err);
    }
  }, []);

  const markAllNotificationsRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    try {
      await fetch('/api/notifications', { method: 'POST' });
    } catch (err) {
      console.error('Failed to mark all notifications read:', err);
    }
  }, []);

  const clearReadNotifications = useCallback(async () => {
    setNotifications((prev) => prev.filter((n) => !n.isRead));
    try {
      await fetch('/api/notifications', { method: 'DELETE' });
    } catch (err) {
      console.error('Failed to clear read notifications:', err);
    }
  }, []);

  const toggleSound = useCallback(() => {
    setIsSoundMuted((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('ticket_sys_sound_muted', String(next));
      }
      updateUserPreferences({ enableSound: !next });
      return next;
    });
  }, [updateUserPreferences]);

  const requestDesktopPermission = useCallback(async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const perm = await Notification.requestPermission();
        setHasDesktopPermission(perm === 'granted');
      } catch (err) {
        console.error('Failed to request desktop notification permission:', err);
      }
    }
  }, []);

  // Centralized Server-Sent Events (SSE) Bus Connection
  useEffect(() => {
    fetchNotifications({ delta: false });

    let eventSource: EventSource | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let isMounted = true;

    function connectSSE() {
      if (typeof window === 'undefined' || !('EventSource' in window)) return;

      if (eventSource) {
        try {
          eventSource.close();
        } catch {
          // ignore
        }
        eventSource = null;
      }

      try {
        eventSource = new EventSource('/api/notifications/stream');

        eventSource.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const data = JSON.parse(event.data);
            if (!data || data.type === 'connected') return;

            // 1. Notification detection & in-app alerts
            const isNotification =
              data.type === 'NOTIFICATION' ||
              (Boolean(data.id) &&
                Boolean(data.title) &&
                Boolean(data.message) &&
                !['TASK_CREATED', 'TASK_UPDATED', 'TASK_DELETED', 'COMMENT_CREATED'].includes(
                  data.type
                ));

            if (isNotification) {
              const newNotif = data as NotificationItem;
              setNotifications((prev) => {
                if (prev.some((n) => n.id === newNotif.id)) return prev;
                return [newNotif, ...prev];
              });
              setUnreadCount((prev) => prev + 1);

              // Rule A: Trigger immediate silent task refresh and space badge refresh
              triggerTaskRefresh({ silent: true });
              refreshSpaces();

              if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
                try {
                  const bc = new BroadcastChannel('ticket_system_realtime');
                  bc.postMessage({ type: 'NOTIFICATION_RECEIVED', notification: newNotif });
                  bc.close();
                } catch {}
              }

              if (!isSoundMutedRef.current) {
                playNotificationChime();
              }

              if (
                typeof window !== 'undefined' &&
                'Notification' in window &&
                Notification.permission === 'granted' &&
                (!document.hasFocus() || document.hidden)
              ) {
                const toast = new Notification(newNotif.title, {
                  body: newNotif.message,
                  icon: '/favicon.ico',
                });
                toast.onclick = () => {
                  window.focus();
                  if (newNotif.taskId) {
                    setSelectedTaskId(newNotif.taskId);
                  }
                };
              }
            }

            // 2. Real-Time Space / List Badge Counters Sync
            if (data.type === 'TASK_UPDATED' || data.type === 'task:updated') {
              const incomingTask = data.task;
              if (incomingTask?.id) {
                const [guardedTask] = applyPendingMutationsToTasks([incomingTask]);
                setTasks((prev) => {
                  const exists = prev.some((t) => t.id === guardedTask.id);
                  if (exists) {
                    return prev.map((t) => (t.id === guardedTask.id ? { ...t, ...guardedTask } : t));
                  }
                  return [guardedTask, ...prev];
                });
              }
            } else if (
              data.type === 'TASK_CREATED' ||
              data.type === 'TASK_DELETED' ||
              data.type === 'task:created'
            ) {
              if (!isMutatingTasks()) {
                refreshSpaces();
                triggerTaskRefresh({ silent: true });
              }
            }

            if (data.type === 'TASK_DELETED') {
              // Auto-close detail drawer if viewing deleted task
              if (selectedTaskIdRef.current === data.taskId) {
                setSelectedTaskId(null);
              }
            }

            // 3. Dispatch operational event to all active sub-components
            listenersRef.current.forEach((listener) => {
              try {
                if (isNotification) {
                  listener({ type: 'NOTIFICATION_RECEIVED', notification: data });
                }
                listener(data);
              } catch (listenerErr) {
                console.error('Error in real-time event listener:', listenerErr);
              }
            });
          } catch (err) {
            console.error('Failed to parse SSE payload:', err);
          }
        };

        eventSource.onerror = async (event: Event) => {
          console.warn('[SSE] Connection interrupted, verifying session status...', event);
          try {
            const check = await fetch('/api/auth/me', { cache: 'no-store' });
            if (check.status === 401) {
              console.warn('[SSE] Session revoked. Redirecting to /login...');
              if (eventSource) {
                eventSource.close();
                eventSource = null;
              }
              window.location.href = '/login';
              return;
            }
          } catch {}

          if (eventSource) {
            try {
              eventSource.close();
            } catch {
              // ignore
            }
            eventSource = null;
          }

          if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
          }

          // Backoff reconnect logic (do NOT throw)
          if (isMounted) {
            reconnectTimeout = setTimeout(() => {
              if (isMounted) connectSSE();
            }, 3000);
          }
        };
      } catch (err) {
        console.warn('[SSE] Failed to establish SSE stream, retrying in 3s...', err);
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        if (isMounted) {
          reconnectTimeout = setTimeout(() => {
            if (isMounted) connectSSE();
          }, 3000);
        }
      }
    }

    connectSSE();

    // Adaptive Delta Sync Heartbeat (10s on local/SSE, 6s on Vercel)
    const isLocal =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const heartbeatMs = isLocal ? 10000 : 6000;

    const deltaHeartbeatInterval = setInterval(() => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible' &&
        !isMutatingTasks()
      ) {
        fetchNotifications({ delta: true });
      }
    }, heartbeatMs);

    const handleFocus = () => {
      if (!isMutatingTasks()) {
        fetchNotifications({ delta: true });
        refreshMasterWorkspaceTasks();
        refreshSpaces();
      }
    };

    window.addEventListener('focus', handleFocus);

    // Cross-tab 0ms BroadcastChannel listener inside WorkspaceContext
    let bc: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        bc = new BroadcastChannel('ticket_system_realtime');
        bc.onmessage = (ev) => {
          const msg = ev.data;
          if (!msg || !msg.type) return;
          if (msg.type === 'TASK_MUTATED' || msg.type === 'TASK_UPDATED' || msg.type === 'TRANSFER') {
            if (msg.task?.id) {
              setTasks((prev) => {
                const exists = prev.some((t) => t.id === msg.task.id);
                if (exists) {
                  return prev.map((t) => (t.id === msg.task.id ? { ...t, ...msg.task } : t));
                }
                return [msg.task, ...prev];
              });
            }
          } else if (msg.type === 'TASK_CREATED' && msg.task?.id) {
            setTasks((prev) => [msg.task, ...prev.filter((t) => t.id !== msg.task.id)]);
          } else if (msg.type === 'TASK_DELETED' && msg.taskId) {
            setTasks((prev) => prev.filter((t) => t.id !== msg.taskId));
          }
        };
      } catch {}
    }

    return () => {
      isMounted = false;
      if (eventSource) {
        try {
          eventSource.close();
        } catch {
          // ignore
        }
        eventSource = null;
      }
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      clearInterval(deltaHeartbeatInterval);
      window.removeEventListener('focus', handleFocus);
      if (bc) {
        try {
          bc.close();
        } catch {}
      }
    };
  }, [fetchNotifications, isMutatingTasks, refreshMasterWorkspaceTasks, refreshSpaces]);

  // Dynamic reactive calculation of open ticket counts per Space/Department and Queue List in 0ms
  const { spaceOpenCounts, listOpenCounts } = useMemo(() => {
    const sCounts: Record<string, number> = {};
    const lCounts: Record<string, number> = {};

    if (!hasLoadedTasks) {
      for (const sp of spaces) {
        sCounts[sp.id] = sp._count?.tasks ?? 0;
        for (const lst of sp.lists || []) {
          lCounts[lst.id] = lst._count?.tasks ?? 0;
        }
      }
      return { spaceOpenCounts: sCounts, listOpenCounts: lCounts };
    }

    for (const sp of spaces) {
      sCounts[sp.id] = 0;
      for (const lst of sp.lists || []) {
        lCounts[lst.id] = 0;
      }
    }

    for (const t of tasks) {
      if (!isTaskStrictlyOpen(t)) continue;
      const spId = t.spaceId || t.space?.id;
      const lstId = t.listId || t.list?.id;
      if (spId) {
        sCounts[spId] = (sCounts[spId] || 0) + 1;
      }
      if (lstId) {
        lCounts[lstId] = (lCounts[lstId] || 0) + 1;
      }
    }

    return { spaceOpenCounts: sCounts, listOpenCounts: lCounts };
  }, [tasks, spaces, hasLoadedTasks]);

  // Computed properties
  const currentSpace = useMemo(() => {
    return activeScope.spaceId
      ? spaces.find((s) => s.id === activeScope.spaceId)
      : undefined;
  }, [activeScope.spaceId, spaces]);

  const currentList = useMemo(() => {
    return currentSpace && activeScope.listId
      ? currentSpace.lists?.find((l) => l.id === activeScope.listId)
      : undefined;
  }, [currentSpace, activeScope.listId]);

  const currentTitle = useMemo(() => {
    if (activeScope.type === 'fastView') {
      if (activeScope.fastViewId === 'everything' || activeScope.fastViewId === 'all') return 'Everything';
      if (activeScope.fastViewId === 'assigned_to_me' || activeScope.fastViewId === 'assigned') return 'Assigned to Me';
      if (activeScope.fastViewId === 'created_by_me' || activeScope.fastViewId === 'created') return 'Created by Me';
      if (activeScope.fastViewId === 'collaborated') return 'Collaborated Tickets';
      return 'Everything';
    } else if (activeScope.type === 'list' && currentList) {
      return currentList.name;
    } else if (currentSpace) {
      return currentSpace.name;
    }
    return 'Everything';
  }, [activeScope, currentList, currentSpace]);

  const contextValue = useMemo<WorkspaceContextType>(() => ({
    workspace,
    spaces,
    isLoading,
    activeScope,
    activeView,
    isSidebarCollapsed,
    expandedSpaceIds,
    createTicketModalOpen,
    createSpaceModalOpen,
    currentSpace,
    currentList,
    currentTitle,
    selectFastView,
    selectSpace,
    selectList,
    setActiveView: handleSetActiveView,
    toggleSidebar,
    toggleSpaceExpanded,
    expandSpace,
    setCreateTicketModalOpen,
    setCreateSpaceModalOpen,
    selectedTaskId,
    setSelectedTaskId,
    refreshSpaces,
    collaboratedCount,
    tasks,
    hasLoadedTasks,
    spaceOpenCounts,
    listOpenCounts,
    syncWorkspaceTasks,
    optimisticAddTask,
    optimisticRemoveTask,
    notifications,
    unreadCount,
    isSoundMuted,
    toggleSound,
    hasDesktopPermission,
    requestDesktopPermission,
    markNotificationRead,
    markAllNotificationsRead,
    clearReadNotifications,
    fetchNotifications,
    subscribeToRealTimeEvents,
    registerTasksRefresher,
    triggerTaskRefresh,
    isMutatingTasks,
    beginTaskMutation,
    endTaskMutation,
    applyPendingMutationsToTasks,
    optimisticUpdateTask,
    registerOptimisticTaskUpdater,
    updateTaskStatusOptimistic,
    optimisticAddSpace,
    optimisticRemoveSpace,
    optimisticAddList,
    optimisticRemoveList,
    userPreferences,
    isPreferencesLoaded,
    updateUserPreferences,
    isSettingsModalOpen,
    setIsSettingsModalOpen,
    isTourOpen,
    setIsTourOpen,
    startTour,
    isSearchModalOpen,
    setIsSearchModalOpen,
  }), [
    workspace,
    spaces,
    isLoading,
    activeScope,
    activeView,
    isSidebarCollapsed,
    expandedSpaceIds,
    createTicketModalOpen,
    createSpaceModalOpen,
    selectedTaskId,
    setSelectedTaskId,
    currentSpace,
    currentList,
    currentTitle,
    selectFastView,
    selectSpace,
    selectList,
    handleSetActiveView,
    toggleSidebar,
    toggleSpaceExpanded,
    expandSpace,
    setCreateTicketModalOpen,
    setCreateSpaceModalOpen,
    refreshSpaces,
    collaboratedCount,
    tasks,
    hasLoadedTasks,
    spaceOpenCounts,
    listOpenCounts,
    syncWorkspaceTasks,
    optimisticAddTask,
    optimisticRemoveTask,
    notifications,
    unreadCount,
    isSoundMuted,
    toggleSound,
    hasDesktopPermission,
    requestDesktopPermission,
    markNotificationRead,
    markAllNotificationsRead,
    clearReadNotifications,
    fetchNotifications,
    subscribeToRealTimeEvents,
    registerTasksRefresher,
    triggerTaskRefresh,
    isMutatingTasks,
    beginTaskMutation,
    endTaskMutation,
    applyPendingMutationsToTasks,
    optimisticUpdateTask,
    registerOptimisticTaskUpdater,
    updateTaskStatusOptimistic,
    optimisticAddSpace,
    optimisticRemoveSpace,
    optimisticAddList,
    optimisticRemoveList,
    userPreferences,
    isPreferencesLoaded,
    updateUserPreferences,
    isSettingsModalOpen,
    isTourOpen,
    startTour,
    isSearchModalOpen,
    setIsSearchModalOpen,
  ]);

  return (
    <WorkspaceContext.Provider value={contextValue}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}

export function useOptionalWorkspace() {
  return useContext(WorkspaceContext);
}

