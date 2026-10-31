'use client';

import React, { useState, useEffect } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  AlertTriangle,
  Clock,
  Plus,
  Pencil,
  Check,
  X,
  Loader2,
  GitPullRequest,
} from 'lucide-react';
import { TaskStatusItem, useWorkspace } from '@/context/workspace-context';
import { TaskRecord } from './ListView';
import { AuthenticatedUser } from '@/lib/security/rbac';
import { getMatchingStatusId, getStatusCategory, getCanonicalStatusColor } from '@/lib/status-utils';
import { evaluateTaskSla } from '@/lib/sla';
import { cn } from '@/lib/utils';
import { TicketResolutionHandoffModal } from '@/components/modals/TicketResolutionHandoffModal';
import { canModifyTicket, hasTicketSpaceClearance } from '@/lib/security/permissions';
import { toast } from '@/components/ui/toast';
import { useBoardDragDrop } from '@/hooks';
import { TaskCard } from './TaskCard';

interface BoardViewProps {
  tasks: TaskRecord[];
  statuses: TaskStatusItem[];
  currentUser: AuthenticatedUser;
  onUpdateStatus: (taskId: string, newStatusId: string) => Promise<void>;
  onTaskClick?: (task: TaskRecord) => void;
  onQuickAdd?: (statusId: string) => void;
  columnCount?: number;
  onColumnCountChange?: (count: number) => void;
  compact?: boolean;
  canManageLists?: boolean;
  spaceId?: string;
  view?: string;
  onOpenManageLists?: () => void;
  onListCreated?: () => void;
  onHandoffComplete?: (task: any, action: 'CLOSE' | 'TRANSFER') => void;
  onStatusRenamed?: (statusId: string, newName: string) => void;
}

const PRIORITY_BADGES: Record<string, { label: string; style: string }> = {
  URGENT: { label: 'Urgent', style: 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/30' },
  HIGH: { label: 'High', style: 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/30' },
  NORMAL: { label: 'Normal', style: 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/30' },
  LOW: { label: 'Low', style: 'bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-500/15 dark:text-slate-400 dark:border-slate-500/30' },
};

const gridColClasses: Record<number, string> = {
  3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
  5: 'grid-cols-1 md:grid-cols-3 lg:grid-cols-5',
  6: 'grid-cols-1 md:grid-cols-3 lg:grid-cols-6',
};

export function BoardView({
  tasks,
  statuses,
  currentUser,
  onUpdateStatus,
  onTaskClick,
  onQuickAdd,
  columnCount: columnCountProp,
  onColumnCountChange,
  compact = false,
  spaceId: spaceIdProp,
  view,
  onHandoffComplete,
  onStatusRenamed,
}: BoardViewProps) {
  const isCompact = Boolean(compact);
  const [internalColumnCount, setInternalColumnCount] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('kanban_column_count') || localStorage.getItem('board_column_density');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if ([3, 4, 5, 6].includes(parsed)) return parsed;
      }
    }
    return 5; // Default to 5 columns
  });
  const [isMobile, setIsMobile] = useState<boolean>(false);

  // Handoff intercept & mutation state
  const [stagedHandoffTask, setStagedHandoffTask] = useState<TaskRecord | null>(null);
  const [isHandoffModalOpen, setIsHandoffModalOpen] = useState<boolean>(false);
  const [mutatingTaskIds, setMutatingTaskIds] = useState<Record<string, boolean>>({});

  const { currentSpace, spaces, refreshSpaces, activeScope } = useWorkspace();
  const effectiveSpaceId = spaceIdProp || currentSpace?.id;

  const isAggregatedView =
    view === 'all' ||
    view === 'assigned' ||
    view === 'created' ||
    view === 'collaborated' ||
    view === 'everything' ||
    view === 'assigned_to_me' ||
    view === 'created_by_me' ||
    activeScope?.type === 'fastView' ||
    !effectiveSpaceId ||
    statuses.some((st) => st.id.startsWith('st-'));

  const canEditStatus = (status: TaskStatusItem) => {
    // Disallow editing synthetic canonical statuses in cross-space views
    if (status.id.startsWith('st-')) return false;
    const targetSpaceId = status.spaceId || effectiveSpaceId;
    if (!targetSpaceId) return currentUser.globalRole === 'SUPERADMIN';
    return hasTicketSpaceClearance(currentUser, targetSpaceId, spaces);
  };

  const [editingStatusId, setEditingStatusId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const [isSavingStatus, setIsSavingStatus] = useState<boolean>(false);
  const [statusSaveError, setStatusSaveError] = useState<string | null>(null);
  const [optimisticNames, setOptimisticNames] = useState<Record<string, string>>({});

  const handleStartEditing = (status: TaskStatusItem) => {
    if (!canEditStatus(status)) return;
    setEditingStatusId(status.id);
    setEditingName(optimisticNames[status.id] || status.name);
    setStatusSaveError(null);
  };

  const handleCancelEditing = () => {
    setEditingStatusId(null);
    setEditingName('');
    setStatusSaveError(null);
  };

  const handleSaveStatusName = async (status: TaskStatusItem) => {
    const trimmed = editingName.trim();
    if (!trimmed) {
      setStatusSaveError('Status name cannot be empty.');
      return;
    }

    if (trimmed.toLowerCase() === (optimisticNames[status.id] || status.name).toLowerCase()) {
      handleCancelEditing();
      return;
    }

    setIsSavingStatus(true);
    setStatusSaveError(null);

    // Optimistically update immediately
    setOptimisticNames((prev) => ({ ...prev, [status.id]: trimmed }));

    try {
      const targetSpaceId = status.spaceId || effectiveSpaceId;
      const url = targetSpaceId
        ? `/api/spaces/${targetSpaceId}/statuses/${status.id}`
        : `/api/statuses/${status.id}`;

      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update status name');
      }

      setEditingStatusId(null);
      setEditingName('');
      onStatusRenamed?.(status.id, trimmed);
      await refreshSpaces();
    } catch (err: any) {
      console.error('Failed to rename status:', err);
      // Revert optimistic update
      setOptimisticNames((prev) => {
        const next = { ...prev };
        delete next[status.id];
        return next;
      });
      setStatusSaveError(err.message || 'Failed to rename status.');
    } finally {
      setIsSavingStatus(false);
    }
  };

  const isResolutionStatus = (status: TaskStatusItem) => {
    return (
      Boolean(status.isClosed) ||
      Boolean(status.isCompleted) ||
      status.category === 'RESOLVED' ||
      status.category === 'CLOSED' ||
      /clos|resolv|done|finish/i.test(status.name)
    );
  };

  const handleMoveToStatus = async (taskId: string, targetStatus: TaskStatusItem) => {
    resetDragState();

    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    // Check clearance using collaborative permissions
    const targetSpaceId = (task as any).spaceId || task.space?.id;
    const canModify = canModifyTicket(currentUser, task, spaces);
    if (!canModify) {
      toast.error(
        'Permission Denied: Only department staff or Superadmins can modify this ticket.',
        'Clearance Denied'
      );
      return;
    }

    // Determine the destination column's target category (e.g., 'PENDING_USER')
    const targetCategory = getStatusCategory(targetStatus);

    // Find the matching status within the ticket's own space to guarantee valid foreign key
    const targetSpace = spaces.find((s) => s.id === targetSpaceId);
    const targetStatusInSpace = targetSpace?.statuses?.find(
      (st) => getStatusCategory(st) === targetCategory
    );
    const resolvedTargetStatus = targetStatusInSpace || targetStatus;

    try {
      setMutatingTaskIds((prev) => ({ ...prev, [taskId]: true }));
      await onUpdateStatus(taskId, resolvedTargetStatus.id);
    } catch (err) {
      console.error('Failed to update ticket status:', err);
    } finally {
      // Crucial: Always reset mutating flag & drag states so card restores full normal opacity
      setMutatingTaskIds((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
      resetDragState();
    }
  };

  // Drag and drop encapsulation via custom hook
  const {
    draggedTaskId,
    dragOverStatusId,
    handleCardDragStart,
    handleCardDragEnd,
    handleColumnDragOver,
    handleColumnDragEnter,
    handleColumnDragLeave,
    handleColumnDrop,
    resetDragState,
  } = useBoardDragDrop({
    onMoveToStatus: (taskId, targetStatus) => handleMoveToStatus(taskId, targetStatus),
  });

  // Sync preference with localStorage and prop
  useEffect(() => {
    try {
      const saved = localStorage.getItem('kanban_column_count') || localStorage.getItem('board_column_density');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (parsed >= 3 && parsed <= 6) {
          setInternalColumnCount(parsed);
        }
      }
    } catch {
      // ignore in environments without localStorage access
    }
  }, []);

  useEffect(() => {
    if (columnCountProp && columnCountProp >= 3 && columnCountProp <= 6) {
      setInternalColumnCount(columnCountProp);
    }
  }, [columnCountProp]);

  // Screen resize detection for responsive mobile view (<768px)
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Sort statuses by order
  const sortedStatuses = [...statuses].sort((a, b) => a.order - b.order);
  const totalStatuses = sortedStatuses.length > 0 ? sortedStatuses.length : 5;
  const maxAllowedCols = Math.max(3, Math.min(totalStatuses, 6));

  const rawColumnCount = columnCountProp ?? internalColumnCount;
  const effectiveColumnCount = Math.max(3, Math.min(rawColumnCount, maxAllowedCols));

  // Auto-clamp columnCount if it exceeds maxAllowedCols (e.g. stored 6 in localStorage, but space has 5 statuses)
  useEffect(() => {
    if (rawColumnCount > maxAllowedCols) {
      setInternalColumnCount(maxAllowedCols);
      try {
        localStorage.setItem('board_column_density', maxAllowedCols.toString());
        localStorage.setItem('kanban_column_count', maxAllowedCols.toString());
      } catch {
        // ignore
      }
      onColumnCountChange?.(maxAllowedCols);
    }
  }, [rawColumnCount, maxAllowedCols, onColumnCountChange]);

  // Dynamic fluid grid template columns across available viewport width
  const gridTemplateColumns = isMobile
    ? 'repeat(1, minmax(0, 1fr))'
    : `repeat(${effectiveColumnCount}, minmax(0, 1fr))`;

  // Map tasks to status cleanly using normalized category and semantic matching
  const tasksByStatus = new Map<string, TaskRecord[]>();
  for (const st of sortedStatuses) {
    tasksByStatus.set(st.id, []);
  }

  for (const t of tasks) {
    let targetColId: string | null = null;

    // 1. Direct ID match first
    const directMatch = sortedStatuses.find((st) => st.id === t.status?.id);
    if (directMatch) {
      targetColId = directMatch.id;
    }

    // 2. Normalized category match
    if (!targetColId) {
      const taskCategory = getStatusCategory(t.status);
      const categoryMatch = sortedStatuses.find((st) => getStatusCategory(st) === taskCategory);
      if (categoryMatch) {
        targetColId = categoryMatch.id;
      }
    }

    // 3. Semantic / fuzzy status matching
    if (!targetColId) {
      targetColId = getMatchingStatusId(t.status, sortedStatuses);
    }

    // 4. Safe fallback: map to first column so no card is ever lost
    if (!targetColId || !tasksByStatus.has(targetColId)) {
      targetColId = sortedStatuses[0]?.id || null;
    }

    if (targetColId && tasksByStatus.has(targetColId)) {
      tasksByStatus.get(targetColId)!.push(t);
    }
  }

  const gridColsClass =
    gridColClasses[effectiveColumnCount] || gridColClasses[5];

  return (
    <div className="flex-1 h-full min-h-0 flex flex-col overflow-hidden select-none">
      {/* Responsive Columns Track */}
      <div
        className={cn(
          'flex-1 min-h-0 grid gap-3.5 p-4 pb-6 overflow-x-auto w-full',
          effectiveColumnCount < sortedStatuses.length ? 'overflow-y-auto' : 'overflow-y-hidden',
          gridColsClass
        )}
      >
        {sortedStatuses.map((status, colIdx) => {
          const columnTasks = tasksByStatus.get(status.id) || [];
          const prevStatus = colIdx > 0 ? sortedStatuses[colIdx - 1] : null;
          const nextStatus = colIdx < sortedStatuses.length - 1 ? sortedStatuses[colIdx + 1] : null;

          return (
            <div
              key={status.id}
              onDragOver={handleColumnDragOver}
              onDragEnter={(e) => handleColumnDragEnter(status.id, e)}
              onDragLeave={(e) => handleColumnDragLeave(status.id, e)}
              onDrop={(e) => handleColumnDrop(status, e)}
              className={cn(
                'min-w-[200px] w-full flex flex-col h-full max-h-full rounded-xl bg-[#D8E1EE]/90 border border-[#C4D1E2] dark:bg-[#12151E]/60 dark:border-white/5 p-3 overflow-hidden transition-all',
                dragOverStatusId === status.id &&
                  (isResolutionStatus(status)
                    ? 'ring-2 ring-emerald-500/80 bg-emerald-50/50 dark:bg-emerald-950/30'
                    : 'ring-2 ring-blue-500/80 bg-blue-50/50 dark:bg-blue-950/30')
              )}
            >
              {/* Column Header */}
              <div className="flex-shrink-0 flex items-center justify-between pb-3 mb-2 border-b border-[#C4D1E2] dark:border-zinc-800/50 relative">
                {editingStatusId === status.id ? (
                  <div
                    className="flex items-center gap-1.5 min-w-0 flex-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: getCanonicalStatusColor(status) }}
                    />
                    <input
                      type="text"
                      autoFocus
                      value={editingName}
                      onChange={(e) => {
                        setEditingName(e.target.value);
                        if (statusSaveError) setStatusSaveError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSaveStatusName(status);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          handleCancelEditing();
                        }
                      }}
                      disabled={isSavingStatus}
                      placeholder="Status name"
                      maxLength={50}
                      className="w-full text-xs font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white dark:bg-zinc-800 border border-blue-500 text-zinc-900 dark:text-zinc-100 outline-none ring-1 ring-blue-500/50 shadow-inner min-w-[70px]"
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveStatusName(status)}
                      disabled={isSavingStatus || !editingName.trim()}
                      title="Save (Enter)"
                      className="p-1 rounded text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/50 disabled:opacity-30 cursor-pointer shrink-0 transition-colors"
                    >
                      {isSavingStatus ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelEditing}
                      disabled={isSavingStatus}
                      title="Cancel (Esc)"
                      className="p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-slate-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 cursor-pointer shrink-0 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 min-w-0 flex-1 group/header">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: getCanonicalStatusColor(status) }}
                    />
                    <h3
                      onDoubleClick={() => {
                        if (canEditStatus(status)) {
                          handleStartEditing(status);
                        }
                      }}
                      title={
                        canEditStatus(status)
                          ? 'Double-click or click pencil to edit status name'
                          : undefined
                      }
                      className={cn(
                        'text-xs font-bold uppercase tracking-wider text-[#0F172A] dark:text-zinc-200 truncate',
                        canEditStatus(status) &&
                          'cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors'
                      )}
                    >
                      {optimisticNames[status.id] || status.name}
                    </h3>
                    <span className="text-[11px] font-mono font-bold text-[#0F172A] bg-[#C7D4E6] border border-[#B2C3DA] dark:text-zinc-400 dark:bg-zinc-900 px-1.5 py-0.5 rounded dark:border-zinc-800 shrink-0">
                      {columnTasks.length}
                    </span>
                    {canEditStatus(status) && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartEditing(status);
                        }}
                        title="Rename status"
                        className="opacity-0 group-hover/header:opacity-100 p-0.5 text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 transition-opacity rounded cursor-pointer shrink-0"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}

                {statusSaveError && editingStatusId === status.id && (
                  <div className="absolute top-full left-2 z-20 mt-1 px-2 py-1 rounded bg-red-600 text-[10px] font-medium text-white shadow-md">
                    {statusSaveError}
                  </div>
                )}

                {onQuickAdd && !editingStatusId && (
                  <button
                    type="button"
                    onClick={() => onQuickAdd(status.id)}
                    title={`Add ticket to ${optimisticNames[status.id] || status.name}`}
                    className="p-1 text-zinc-400 hover:text-zinc-700 hover:bg-slate-100 dark:text-zinc-500 dark:hover:text-zinc-200 dark:hover:bg-zinc-800/80 rounded transition-colors cursor-pointer shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Scrollable Card Drop Zone */}
              <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1 scrollbar-thin scrollbar-thumb-zinc-700/50 scrollbar-track-transparent custom-scrollbar pb-2">
                {columnTasks.length === 0 ? (
                  <div className="h-full min-h-[140px] flex-1 border border-dashed border-slate-300 dark:border-zinc-800/70 rounded-lg flex items-center justify-center text-xs text-zinc-400 dark:text-zinc-500 italic select-none">
                    No tasks
                  </div>
                ) : (
                  columnTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      currentUser={currentUser}
                      spaces={spaces}
                      isCompact={isCompact}
                      isDragging={draggedTaskId === task.id}
                      isMutating={Boolean(mutatingTaskIds[task.id])}
                      prevStatus={prevStatus}
                      nextStatus={nextStatus}
                      onCardClick={onTaskClick}
                      onDragStart={(e) => handleCardDragStart(task.id, e)}
                      onDragEnd={handleCardDragEnd}
                      onMoveToStatus={handleMoveToStatus}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Ticket Resolution & Cross-Department Hand-off Intercept Modal */}
      {isHandoffModalOpen && stagedHandoffTask && (
        <TicketResolutionHandoffModal
          isOpen={isHandoffModalOpen}
          onClose={() => {
            setIsHandoffModalOpen(false);
            setStagedHandoffTask(null);
            resetDragState();
          }}
          task={{
            id: stagedHandoffTask.id,
            taskKey: stagedHandoffTask.taskKey,
            title: stagedHandoffTask.title,
            spaceId: stagedHandoffTask.space.id,
            space: stagedHandoffTask.space,
            listId: stagedHandoffTask.list.id,
            list: stagedHandoffTask.list,
          }}
          currentUser={currentUser}
          onSuccess={async (updatedTask, action) => {
            setIsHandoffModalOpen(false);
            setStagedHandoffTask(null);
            resetDragState();
            if (action === 'TRANSFER') {
              onHandoffComplete?.(updatedTask, 'TRANSFER');
            } else {
              if (updatedTask?.statusId) {
                await onUpdateStatus(updatedTask.id, updatedTask.statusId);
              }
              onHandoffComplete?.(updatedTask, 'CLOSE');
            }
          }}
        />
      )}
    </div>
  );
}
