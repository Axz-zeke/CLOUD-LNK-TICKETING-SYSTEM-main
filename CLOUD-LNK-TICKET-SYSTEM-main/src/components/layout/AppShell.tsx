'use client';

import React, { useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { WorkspaceProvider, useWorkspace } from '@/context/workspace-context';
import { Sidebar } from './Sidebar';
import { HeaderBar } from './HeaderBar';
import { ViewToolbar } from '@/components/views/ViewToolbar';
import { ListView, TaskRecord } from '@/components/views/ListView';
import { BoardView } from '@/components/views/BoardView';
import { GanttView } from '@/components/views/GanttView';
import { DashboardView } from '@/components/views/DashboardView';
import { CreateTicketModal } from '@/components/modals/CreateTicketModal';
import { CreateSpaceModal } from '@/components/modals/CreateSpaceModal';
import { DepartmentManagementModal } from '@/components/modals/DepartmentManagementModal';
import { UserSettingsModal } from '@/components/modals/UserSettingsModal';
import { GlobalSearchModal } from '@/components/modals/GlobalSearchModal';
import { TaskDetailDrawer } from '@/components/drawers/TaskDetailDrawer';
import { WorkspaceTour } from '@/components/onboarding/WorkspaceTour';
import { WelcomeModal } from '@/components/onboarding/WelcomeModal';
import { AuthenticatedUser } from '@/lib/security/rbac';
import { CANONICAL_STATUSES } from '@/lib/status-utils';
import { toast } from '@/components/ui/toast';
import { useTicketMutations } from '@/hooks';
import { fetchWithClientCache, invalidateClientTasksCache, prependClientCachedTask } from '@/lib/client-cache';
import {
  LayoutList,
  Kanban,
  Ticket,
  Plus,
  X,
  AlertCircle,
  RefreshCw,
  UserCheck,
  Sparkles,
  ListTodo,
} from 'lucide-react';

interface AppShellProps {
  user: AuthenticatedUser;
  children?: ReactNode;
}

function ShellContent({ user, children }: { user: AuthenticatedUser; children?: ReactNode }) {
  const {
    spaces,
    activeScope,
    activeView,
    currentSpace,
    currentList,
    currentTitle,
    createTicketModalOpen,
    setCreateTicketModalOpen,
    createSpaceModalOpen,
    setCreateSpaceModalOpen,
    optimisticAddSpace,
    refreshSpaces,
    expandSpace,
    selectList,
    selectSpace,
    selectedTaskId,
    setSelectedTaskId,
    subscribeToRealTimeEvents,
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
    registerTasksRefresher,
    isMutatingTasks,
    applyPendingMutationsToTasks,
    registerOptimisticTaskUpdater,
    syncWorkspaceTasks,
    optimisticAddTask,
    optimisticRemoveTask,
    optimisticUpdateTask,
  } = useWorkspace();

  // Onboarding first-time welcome dialog state
  const [welcomeModalOpen, setWelcomeModalOpen] = useState(false);
  const [hasPromptedTour, setHasPromptedTour] = useState(false);
  const [manageListsModalOpen, setManageListsModalOpen] = useState(false);

  // First-time login detection
  useEffect(() => {
    if (isPreferencesLoaded && !hasPromptedTour) {
      if (!userPreferences?.hasCompletedTour) {
        setWelcomeModalOpen(true);
      }
      setHasPromptedTour(true);
    }
  }, [isPreferencesLoaded, userPreferences?.hasCompletedTour, hasPromptedTour]);

  // Task data state
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [taskError, setTaskError] = useState<string | null>(null);

  // Connect optimistic task updater from workspace context
  useEffect(() => {
    return registerOptimisticTaskUpdater((taskId, updater) => {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updater(t) : t)));
    });
  }, [registerOptimisticTaskUpdater]);

  // Filters state
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Board column density (3 to 6, default 5, synced with user preferences and localStorage)
  const [boardColumns, setBoardColumns] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('kanban_column_count') || localStorage.getItem('board_column_density');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if ([3, 4, 5, 6].includes(parsed)) return parsed;
      }
    }
    return userPreferences?.boardDensity || 5;
  });

  // Gantt Timeline controls & update state
  const [ganttScale, setGanttScale] = useState<'day' | 'week' | 'month'>('day');
  const [ganttMilestonesOnly, setGanttMilestonesOnly] = useState(false);

  const handleUpdateTaskDates = useCallback(
    async (taskId: string, startDate: string, dueDate: string) => {
      try {
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ startDate, dueDate }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message || 'Failed to update schedule');
        }
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, startDate, dueDate } : t))
        );
      } catch (err: any) {
        toast.error(err.message || 'Failed to update schedule', 'Schedule Error');
      }
    },
    []
  );

  // Synchronize boardColumns with userPreferences
  useEffect(() => {
    if (userPreferences?.boardDensity && [3, 4, 5, 6].includes(userPreferences.boardDensity)) {
      setBoardColumns(userPreferences.boardDensity);
    }
  }, [userPreferences?.boardDensity]);

  // Check URL query parameters for ?settings=1 or ?settings=true
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('settings') === '1' || params.get('settings') === 'true') {
        setIsSettingsModalOpen(true);
      }
    }
  }, [setIsSettingsModalOpen]);


  // Fetch tasks matching active scope and filters
  const fetchTasks = useCallback(async (opts?: { silent?: boolean; forceFresh?: boolean }) => {
    // If background silent polling while an optimistic mutation is in flight, skip to avoid rubber-banding
    if (opts?.silent && isMutatingTasks()) {
      return;
    }

    if (!opts?.silent) {
      setLoadingTasks(true);
    }
    setTaskError(null);

    try {
      const params = new URLSearchParams();
      const hasActiveFilters = Boolean(
        search.trim() || priorityFilter || statusFilter || assigneeFilter || dateFrom || dateTo
      );
      const isEverythingUnfiltered =
        !hasActiveFilters &&
        activeScope.type === 'fastView' &&
        (activeScope.fastViewId === 'everything' || activeScope.fastViewId === 'all' || !activeScope.fastViewId);

      if (activeScope.type === 'fastView' && activeScope.fastViewId) {
        if (activeScope.fastViewId === 'assigned_to_me' || activeScope.fastViewId === 'assigned') {
          params.set('fastView', 'assigned_to_me');
        } else if (activeScope.fastViewId === 'created_by_me' || activeScope.fastViewId === 'created') {
          params.set('fastView', 'created_by_me');
        } else if (activeScope.fastViewId === 'collaborated') {
          params.set('fastView', 'collaborated');
        } else {
          params.set('fastView', 'everything');
        }
      } else if (activeScope.type === 'space' && activeScope.spaceId) {
        params.set('spaceId', activeScope.spaceId);
      } else if (activeScope.type === 'list' && activeScope.spaceId && activeScope.listId) {
        params.set('spaceId', activeScope.spaceId);
        params.set('listId', activeScope.listId);
      }

      if (search.trim()) params.set('search', search.trim());
      if (priorityFilter) params.set('priority', priorityFilter);
      if (statusFilter) params.set('statusId', statusFilter);
      if (assigneeFilter) params.set('assigneeId', assigneeFilter);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);

      const url = `/api/tasks?${params.toString()}`;
      const data = await fetchWithClientCache<{ tasks: TaskRecord[] }>(url, {
        ttlMs: 30_000,
        forceFresh: opts?.forceFresh,
        onCachedData: (cached) => {
          if (!isMutatingTasks()) {
            const guardedCached = applyPendingMutationsToTasks(cached.tasks || []);
            setTasks(guardedCached);
            syncWorkspaceTasks(guardedCached, isEverythingUnfiltered);
          }
          if (!opts?.silent) {
            setLoadingTasks(false);
          }
        },
      });

      if (!isMutatingTasks()) {
        const guardedTasks = applyPendingMutationsToTasks(data.tasks || []);
        setTasks(guardedTasks);
        syncWorkspaceTasks(guardedTasks, isEverythingUnfiltered);
      }
    } catch (err) {
      setTaskError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (!opts?.silent) {
        setLoadingTasks(false);
      }
    }
  }, [activeScope, search, priorityFilter, statusFilter, assigneeFilter, dateFrom, dateTo, isMutatingTasks, applyPendingMutationsToTasks, syncWorkspaceTasks]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Connect silent task refresher with workspace-context notification triggers
  useEffect(() => {
    return registerTasksRefresher(fetchTasks);
  }, [registerTasksRefresher, fetchTasks]);

  // Rule B: Silent background polling (every 8s while tab is visible) across ALL views
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchTasks({ silent: true });
      }
    }, 8000);

    return () => clearInterval(interval);
  }, [fetchTasks]);

  // Cross-tab & Cross-window instant sync via BroadcastChannel
  useEffect(() => {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return;
    const channel = new BroadcastChannel('ticket_system_realtime');
    channel.onmessage = (event) => {
      if (!event.data) return;
      const msg = event.data;
      if ((msg.type === 'TASK_MUTATED' || msg.type === 'TASK_UPDATED') && msg.task?.id) {
        const [guardedTask] = applyPendingMutationsToTasks([msg.task]);
        setTasks((prev) =>
          prev.map((t) => (t.id === guardedTask.id ? { ...t, ...guardedTask } : t))
        );
        syncWorkspaceTasks([guardedTask], false);
        return;
      }
      if (
        [
          'TASK_CREATED',
          'TASK_DELETED',
          'STATUS_CHANGE',
          'TRANSFER',
          'NOTIFICATION_RECEIVED',
        ].includes(msg.type)
      ) {
        if (!isMutatingTasks()) {
          invalidateClientTasksCache();
          refreshSpaces();
          fetchTasks({ silent: true, forceFresh: true });
        }
      }
    };
    return () => {
      channel.close();
    };
  }, [fetchTasks, refreshSpaces, applyPendingMutationsToTasks, syncWorkspaceTasks, isMutatingTasks]);

  // Real-Time Event Sync: Listen to live operational pipeline (<100ms updates)
  useEffect(() => {
    const unsubscribe = subscribeToRealTimeEvents((event: any) => {
      if (!event || !event.type) return;

      if (event.type === 'TASK_CREATED') {
        const { task, spaceId, listId } = event;
        if (!task) return;

        // Check relevance to user's active view/scope
        let isRelevant = false;
        if (activeScope.type === 'fastView') {
          if (activeScope.fastViewId === 'everything' || activeScope.fastViewId === 'all') isRelevant = true;
          else if (activeScope.fastViewId === 'collaborated') isRelevant = true;
          else if (activeScope.fastViewId === 'assigned_to_me' || activeScope.fastViewId === 'assigned') isRelevant = task.assigneeId === user?.id;
          else if (activeScope.fastViewId === 'created_by_me' || activeScope.fastViewId === 'created') isRelevant = task.createdById === user?.id;
        } else if (activeScope.type === 'space') {
          isRelevant = activeScope.spaceId === spaceId;
        } else if (activeScope.type === 'list') {
          isRelevant = activeScope.spaceId === spaceId && activeScope.listId === listId;
        }

        if (isRelevant) {
          setTasks((prev) => {
            const exists = prev.some((t) => t.id === task.id);
            if (exists) {
              return prev.map((t) => (t.id === task.id ? { ...t, ...task } : t));
            }
            return [task, ...prev];
          });
        }
      } else if (event.type === 'TASK_UPDATED' || event.type === 'task:updated') {
        const rawTask = event.task || event;
        if (!rawTask || !rawTask.id) return;
        const [task] = applyPendingMutationsToTasks([rawTask]);

        setTasks((prev) => {
          const exists = prev.some((t) => t.id === task.id);
          if (exists) {
            // Never drop a task from the Collaborated view when its status changes in target department!
            if (activeScope.type === 'fastView' && activeScope.fastViewId === 'collaborated') {
              return prev.map((t) => (t.id === task.id ? { ...t, ...task } : t));
            }
            // If viewing "Assigned to Me" and ticket reassigned away
            if (
              activeScope.type === 'fastView' &&
              (activeScope.fastViewId === 'assigned_to_me' || activeScope.fastViewId === 'assigned') &&
              task.assigneeId !== user?.id
            ) {
              return prev.filter((t) => t.id !== task.id);
            }
            // If viewing a specific list and ticket moved to another list
            if (
              activeScope.type === 'list' &&
              (activeScope.spaceId !== (event.spaceId || task.spaceId) ||
                activeScope.listId !== (event.listId || task.listId))
            ) {
              return prev.filter((t) => t.id !== task.id);
            }
            // Update in place (Kanban column moves or priority/assignee chip transitions)
            return prev.map((t) => (t.id === task.id ? { ...t, ...task } : t));
          } else {
            // Check if ticket newly qualifies for the active view
            let isNewlyRelevant = false;
            if (activeScope.type === 'fastView') {
              if (activeScope.fastViewId === 'everything' || activeScope.fastViewId === 'all') isNewlyRelevant = true;
              else if (activeScope.fastViewId === 'collaborated') isNewlyRelevant = true;
              else if (activeScope.fastViewId === 'assigned_to_me' || activeScope.fastViewId === 'assigned') isNewlyRelevant = task.assigneeId === user?.id;
              else if (activeScope.fastViewId === 'created_by_me' || activeScope.fastViewId === 'created') isNewlyRelevant = task.createdById === user?.id;
            } else if (activeScope.type === 'space') {
              isNewlyRelevant = activeScope.spaceId === (event.spaceId || task.spaceId);
            } else if (activeScope.type === 'list') {
              isNewlyRelevant =
                activeScope.spaceId === (event.spaceId || task.spaceId) &&
                activeScope.listId === (event.listId || task.listId);
            }

            if (isNewlyRelevant) {
              return [task, ...prev];
            }
            return prev;
          }
        });
      } else if (event.type === 'TASK_DELETED') {
        const { taskId } = event;
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
        optimisticRemoveTask(taskId);
        if (selectedTaskId === taskId) {
          setSelectedTaskId(null);
        }
      } else if (event.type === 'COMMENT_CREATED') {
        const { taskId } = event;
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            return {
              ...t,
              _count: {
                comments: (t._count?.comments || 0) + 1,
                attachments: t._count?.attachments || 0,
              },
            };
          })
        );
      } else if (
        event.type === 'NOTIFICATION_RECEIVED' ||
        event.type === 'STATUS_UPDATED' ||
        event.type === 'task:created' ||
        event.action === 'TRANSFER' ||
        event.action === 'HANDOFF_RECEIVED'
      ) {
        refreshSpaces();
        fetchTasks({ silent: true });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [subscribeToRealTimeEvents, activeScope, user?.id, selectedTaskId, setSelectedTaskId, fetchTasks, refreshSpaces]);

  // Available statuses for active Space or canonical statuses for cross-space Fast Views
  const availableStatuses = useMemo(() => {
    if (activeScope.type === 'fastView') {
      return CANONICAL_STATUSES;
    }
    return currentSpace?.statuses && currentSpace.statuses.length > 0
      ? currentSpace.statuses
      : CANONICAL_STATUSES;
  }, [activeScope.type, currentSpace?.statuses]);

  // Dynamic clamping for Kanban column count based on availableStatuses
  const totalStatuses = availableStatuses.length > 0 ? availableStatuses.length : 5;
  const maxAllowedCols = Math.max(3, Math.min(totalStatuses, 6));

  useEffect(() => {
    if (boardColumns > maxAllowedCols) {
      setBoardColumns(maxAllowedCols);
      try {
        localStorage.setItem('board_column_density', maxAllowedCols.toString());
        localStorage.setItem('kanban_column_count', maxAllowedCols.toString());
      } catch {
        // ignore
      }
    }
  }, [boardColumns, maxAllowedCols]);

  const handleBoardColumnsChange = useCallback(
    (cols: number) => {
      const clamped = Math.max(3, Math.min(maxAllowedCols, cols));
      setBoardColumns(clamped);
      try {
        localStorage.setItem('board_column_density', clamped.toString());
        localStorage.setItem('kanban_column_count', clamped.toString());
      } catch {
        // ignore
      }
      updateUserPreferences({ boardDensity: clamped });
    },
    [maxAllowedCols, updateUserPreferences]
  );

  // Decoupled ticket mutations hook with optimistic snapshot rollback & error toast handling
  const {
    handleUpdateStatus,
    handleUpdatePriority,
    handleAssignToMe,
  } = useTicketMutations({
    tasks,
    setTasks,
    availableStatuses,
    spaces,
    currentUserId: user?.id,
    refreshSpaces,
  });

  const handleClearFilters = () => {
    setSearch('');
    setPriorityFilter('');
    setStatusFilter('');
    setAssigneeFilter('');
    setDateFrom('');
    setDateTo('');
  };

  const handleCloseCreateModal = useCallback(() => {
    setCreateTicketModalOpen(false);
  }, [setCreateTicketModalOpen]);

  const handleCloseCreateSpaceModal = useCallback(() => {
    setCreateSpaceModalOpen(false);
  }, [setCreateSpaceModalOpen]);

  const handleSpaceCreated = useCallback(
    async (newSpace: any) => {
      if (newSpace?.id) {
        optimisticAddSpace(newSpace);
        expandSpace(newSpace.id);
        const firstList = newSpace.lists?.[0];
        if (firstList?.id) {
          selectList(newSpace.id, firstList.id);
        } else {
          selectSpace(newSpace.id);
        }
      }
      await refreshSpaces();
    },
    [optimisticAddSpace, refreshSpaces, expandSpace, selectList, selectSpace]
  );

  const handleTicketCreated = useCallback((newTask: any) => {
    if (newTask?.id) {
      prependClientCachedTask(newTask);
      optimisticAddTask(newTask);
      setTasks((prev) => [newTask, ...prev.filter((t) => t.id !== newTask.id)]);
      setSelectedTaskId(newTask.id);
    }
    fetchTasks({ silent: true, forceFresh: true });
    refreshSpaces();
  }, [fetchTasks, refreshSpaces, optimisticAddTask, setSelectedTaskId]);

  const handleCloseDetailDrawer = useCallback(() => {
    setSelectedTaskId(null);
  }, [setSelectedTaskId]);

  const handleTaskUpdated = useCallback((updatedTask: any) => {
    if (updatedTask?.id) {
      setTasks((prev) =>
        prev.map((t) => (t.id === updatedTask.id ? { ...t, ...updatedTask } : t))
      );
      optimisticUpdateTask(updatedTask.id, (t: any) => ({ ...t, ...updatedTask }));
      refreshSpaces();
    }
  }, [refreshSpaces, optimisticUpdateTask]);

  const handleStatusRenamed = useCallback(
    (statusId: string, newName: string) => {
      setTasks((prev) =>
        prev.map((t) =>
          t.status?.id === statusId ? { ...t, status: { ...t.status, name: newName } } : t
        )
      );
      fetchTasks();
    },
    [fetchTasks]
  );



  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#E2E8F2] text-[#0F172A] dark:bg-[#0B0D13] dark:text-zinc-100">
      {/* 1. Left Collapsible Sidebar */}
      <Sidebar user={user} />

      {/* 2. Main Right Work Canvas */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header Navigation */}
        <HeaderBar currentUser={user} />

        {/* View Canvas Body */}
        <main
          className={`flex-1 relative z-10 bg-[#E2E8F2] dark:bg-[#0B0D13] ${
            activeView === 'board' || activeView === 'gantt'
              ? 'overflow-hidden flex flex-col min-h-0'
              : 'overflow-y-auto p-4 sm:p-6 space-y-4'
          }`}
        >
          {children ? (
            children
          ) : (
            <div
              className={
                activeView === 'board' || activeView === 'gantt'
                  ? 'flex-1 h-full min-h-0 flex flex-col overflow-hidden'
                  : 'max-w-7xl mx-auto space-y-4'
              }
            >
              {/* Filter Toolbar */}
              <div className={activeView === 'board' || activeView === 'gantt' ? 'px-4 pt-3 flex-shrink-0' : 'flex-shrink-0'}>
                <ViewToolbar
                  search={search}
                  onSearchChange={setSearch}
                  priorityFilter={priorityFilter}
                  onPriorityChange={setPriorityFilter}
                  statusFilter={statusFilter}
                  onStatusChange={setStatusFilter}
                  assigneeFilter={assigneeFilter}
                  onAssigneeChange={setAssigneeFilter}
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  onDateRangeChange={(from, to) => {
                    setDateFrom(from);
                    setDateTo(to);
                  }}
                  availableStatuses={availableStatuses}
                  onClearFilters={handleClearFilters}
                  onRefresh={fetchTasks}
                  isLoading={loadingTasks}
                  totalTasksCount={tasks.length}
                  activeView={activeView}
                  boardColumns={boardColumns}
                  columnCount={boardColumns}
                  onBoardColumnsChange={handleBoardColumnsChange}
                  onColumnCountChange={handleBoardColumnsChange}
                  ganttScale={ganttScale}
                  onGanttScaleChange={setGanttScale}
                  onGanttTodayClick={() => {
                    window.dispatchEvent(new CustomEvent('gantt:scroll-today'));
                  }}
                  ganttMilestonesOnly={ganttMilestonesOnly}
                  onGanttMilestonesOnlyChange={setGanttMilestonesOnly}
                />
              </div>

              {/* Error Banner */}
              {taskError && (
                <div className={activeView === 'board' || activeView === 'gantt' ? 'px-4 pt-2 flex-shrink-0' : 'flex-shrink-0'}>
                  <div className="p-3.5 rounded-xl bg-red-100 dark:bg-red-950/70 border border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-200 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 dark:text-red-400 shrink-0" />
                    <span>{taskError}</span>
                  </div>
                </div>
              )}

              {/* View Matrix: Board | Gantt | Dashboard | List */}
              {loadingTasks ? (
                <div className="min-h-[300px] flex-1 flex items-center justify-center text-xs text-zinc-500 gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-zinc-400" />
                  <span>Loading workspace tickets...</span>
                </div>
              ) : activeView === 'board' ? (
                <BoardView
                  tasks={tasks}
                  statuses={availableStatuses}
                  currentUser={user}
                  onUpdateStatus={handleUpdateStatus}
                  onTaskClick={(task) => setSelectedTaskId(task.id)}
                  onQuickAdd={() => setCreateTicketModalOpen(true)}
                  columnCount={boardColumns}
                  onColumnCountChange={handleBoardColumnsChange}
                  compact={userPreferences?.compactCards}
                  spaceId={currentSpace?.id}
                  view={activeScope.type === 'fastView' ? (activeScope.fastViewId || (activeScope as any).id) : undefined}
                  onStatusRenamed={handleStatusRenamed}
                  onHandoffComplete={async (task, action) => {
                    if (task?.id) {
                      optimisticUpdateTask(task.id, (t: any) => ({ ...t, ...task }));
                    }
                    if (action === 'TRANSFER' && activeScope.type !== 'fastView') {
                      setTasks((prev) => prev.filter((t) => t.id !== task.id));
                    }
                    await fetchTasks({ forceFresh: true });
                    await refreshSpaces();
                  }}
                />
              ) : activeView === 'gantt' ? (
                <GanttView
                  tasks={tasks}
                  statuses={availableStatuses}
                  currentUser={user}
                  onTaskClick={(task) => setSelectedTaskId(task.id)}
                  onUpdateDates={handleUpdateTaskDates}
                  onUpdateStatus={handleUpdateStatus}
                  scale={ganttScale}
                  onScaleChange={setGanttScale}
                  milestonesOnly={ganttMilestonesOnly}
                />
              ) : activeView === 'dashboard' ? (
                <DashboardView
                  tasks={tasks}
                  statuses={availableStatuses}
                  currentUser={user}
                  onTaskClick={(task) => setSelectedTaskId(task.id)}
                  onUpdateStatus={handleUpdateStatus}
                  onPriorityFilterClick={(p) => setPriorityFilter(p)}
                />
              ) : tasks.length === 0 ? (
                <div className="min-h-[360px] flex flex-col items-center justify-center text-center p-8 bg-white border border-slate-200 dark:bg-zinc-900/30 dark:border-zinc-800/80 rounded-2xl shadow-xs">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 border border-slate-200 dark:bg-zinc-900 dark:border-zinc-800 flex items-center justify-center mb-3 text-zinc-500 dark:text-zinc-400 shadow-inner">
                    {activeScope.type === 'fastView' &&
                    (activeScope.fastViewId === 'assigned_to_me' || activeScope.fastViewId === 'assigned') ? (
                      <UserCheck className="w-6 h-6 text-blue-500 dark:text-blue-400" />
                    ) : activeScope.type === 'fastView' &&
                      (activeScope.fastViewId === 'created_by_me' || activeScope.fastViewId === 'created') ? (
                      <Ticket className="w-6 h-6 text-emerald-500 dark:text-emerald-400" />
                    ) : activeScope.type === 'fastView' ? (
                      <Sparkles className="w-6 h-6 text-purple-500 dark:text-purple-400" />
                    ) : (
                      <ListTodo className="w-6 h-6 text-zinc-500 dark:text-zinc-400" />
                    )}
                  </div>

                  <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                    {Boolean(search.trim() || priorityFilter || statusFilter || assigneeFilter || dateFrom || dateTo)
                      ? 'No matching tickets found'
                      : activeScope.type === 'fastView' &&
                        (activeScope.fastViewId === 'assigned_to_me' || activeScope.fastViewId === 'assigned')
                      ? 'No tickets assigned to you'
                      : activeScope.type === 'fastView' &&
                        (activeScope.fastViewId === 'created_by_me' || activeScope.fastViewId === 'created')
                      ? 'No tickets created yet'
                      : activeScope.type === 'fastView'
                      ? 'No tickets available'
                      : `No tickets in ${currentTitle}`}
                  </h3>

                  <p className="text-xs text-zinc-500 max-w-sm mt-1.5 leading-relaxed">
                    {Boolean(search.trim() || priorityFilter || statusFilter || assigneeFilter || dateFrom || dateTo)
                      ? 'No tickets match your active filter criteria. Try adjusting or clearing your filters.'
                      : activeScope.type === 'fastView' &&
                        (activeScope.fastViewId === 'assigned_to_me' || activeScope.fastViewId === 'assigned')
                      ? 'All caught up! Any tickets assigned to your name will appear here.'
                      : activeScope.type === 'fastView' &&
                        (activeScope.fastViewId === 'created_by_me' || activeScope.fastViewId === 'created')
                      ? "You haven't submitted any tickets yet. Click '+ New Ticket' to submit an issue or request to any department."
                      : activeScope.type === 'fastView'
                      ? 'There are currently no tickets matching your clearance permissions.'
                      : 'This queue is currently empty. Incoming tickets will appear here automatically.'}
                  </p>

                  {Boolean(search.trim() || priorityFilter || statusFilter || assigneeFilter || dateFrom || dateTo) ? (
                    <button
                      type="button"
                      onClick={handleClearFilters}
                      className="mt-4 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition-colors cursor-pointer"
                    >
                      Clear Active Filters
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setCreateTicketModalOpen(true)}
                      className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-sm cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>New Ticket</span>
                    </button>
                  )}
                </div>
              ) : (
                <ListView
                  tasks={tasks}
                  statuses={availableStatuses}
                  currentUser={user}
                  onUpdateStatus={handleUpdateStatus}
                  onUpdatePriority={handleUpdatePriority}
                  onAssignToMe={handleAssignToMe}
                  onTaskClick={(task) => setSelectedTaskId(task.id)}
                  compact={userPreferences?.compactCards}
                  spaceId={currentSpace?.id}
                  onStatusRenamed={handleStatusRenamed}
                  onHandoffComplete={async (task, action) => {
                    if (task?.id) {
                      optimisticUpdateTask(task.id, (t: any) => ({ ...t, ...task }));
                    }
                    if (action === 'TRANSFER' && activeScope.type !== 'fastView') {
                      setTasks((prev) => prev.filter((t) => t.id !== task.id));
                    }
                    await fetchTasks({ forceFresh: true });
                    await refreshSpaces();
                  }}
                />
              )}
            </div>
          )}
        </main>
      </div>

      {/* Global Add Ticket Intake Modal */}
      {createTicketModalOpen && (
        <CreateTicketModal
          isOpen={createTicketModalOpen}
          onClose={handleCloseCreateModal}
          onTicketCreated={handleTicketCreated}
          currentUser={user}
        />
      )}

      {/* Dynamic Create Space Modal */}
      {createSpaceModalOpen && (
        <CreateSpaceModal
          isOpen={createSpaceModalOpen}
          onClose={handleCloseCreateSpaceModal}
          onSpaceCreated={handleSpaceCreated}
          currentUser={user}
        />
      )}

      {/* Personal User Settings & Preferences Modal */}
      {isSettingsModalOpen && (
        <UserSettingsModal
          isOpen={isSettingsModalOpen}
          onClose={() => setIsSettingsModalOpen(false)}
          currentUser={user}
          onStartTour={startTour}
        />
      )}

      {/* Dynamic Department Queue Lists Management Modal */}
      {manageListsModalOpen && (
        <DepartmentManagementModal
          isOpen={manageListsModalOpen}
          onClose={() => setManageListsModalOpen(false)}
          currentUser={user}
          initialSpaceId={currentSpace?.id}
          onQueuesChanged={async () => {
            await refreshSpaces();
            fetchTasks();
          }}
        />
      )}

      {/* Guided Onboarding Interactive Tour */}
      <WorkspaceTour
        isOpen={isTourOpen}
        onClose={() => {
          setIsTourOpen(false);
          updateUserPreferences({ hasCompletedTour: true });
        }}
        onComplete={() => {
          setIsTourOpen(false);
          updateUserPreferences({ hasCompletedTour: true });
        }}
      />

      {/* First-Time User Welcome Modal */}
      <WelcomeModal
        isOpen={welcomeModalOpen}
        onStartTour={() => {
          setWelcomeModalOpen(false);
          startTour();
        }}
        onSkip={() => {
          setWelcomeModalOpen(false);
          updateUserPreferences({ hasCompletedTour: true });
        }}
      />

      {/* Strict Permission-Aware Global Search Command Palette (Cmd+K / Ctrl+K) */}
      <GlobalSearchModal
        isOpen={isSearchModalOpen}
        onClose={() => setIsSearchModalOpen(false)}
        currentUser={user}
      />

      {/* Slide-Over Task Detail Drawer */}
      {Boolean(selectedTaskId) && (
        <TaskDetailDrawer
          taskId={selectedTaskId}
          initialTask={tasks.find((t) => t.id === selectedTaskId) || null}
          isOpen={Boolean(selectedTaskId)}
          onClose={handleCloseDetailDrawer}
          currentUser={user}
          onTaskUpdated={handleTaskUpdated}
        />
      )}
    </div>
  );
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class WorkspaceErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('WorkspaceErrorBoundary caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-zinc-300 p-6 space-y-4">
          <div className="w-12 h-12 rounded-xl bg-red-950/80 border border-red-800 flex items-center justify-center text-red-400">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-semibold text-zinc-100">Workspace Encountered an Error</h2>
          <p className="text-xs text-zinc-400 max-w-md text-center">
            {this.state.error?.message || 'An unexpected rendering error occurred while loading the workspace.'}
          </p>
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium rounded-lg border border-zinc-700 transition-colors cursor-pointer"
            >
              Reload Workspace
            </button>
            <button
              type="button"
              onClick={() => {
                document.cookie = 'lan_session_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
                window.location.href = '/login';
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              Back to Login
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function AppShell({ user, children }: AppShellProps) {
  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-400 font-sans text-xs">
        Loading workspace session...
      </div>
    );
  }

  return (
    <WorkspaceErrorBoundary>
      <WorkspaceProvider user={user}>
        <ShellContent user={user}>{children}</ShellContent>
      </WorkspaceProvider>
    </WorkspaceErrorBoundary>
  );
}
