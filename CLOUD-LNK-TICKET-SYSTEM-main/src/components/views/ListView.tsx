'use client';

import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  MessageSquare,
  AlertCircle,
  Pencil,
  Check,
  X,
  Loader2,
  GitPullRequest,
  CheckSquare,
  Paperclip,
} from 'lucide-react';
import { TaskStatusItem, useWorkspace } from '@/context/workspace-context';
import { AuthenticatedUser } from '@/lib/security/rbac';
import { evaluateTaskSla } from '@/lib/sla';
import { CANONICAL_STATUSES, getMatchingStatusId, getStatusCategory, getCanonicalStatusColor } from '@/lib/status-utils';
import { TicketResolutionHandoffModal } from '@/components/modals/TicketResolutionHandoffModal';
import { cn } from '@/lib/utils';
import type { TaskCollaborationInfo } from '@/lib/collaboration';
import { canModifyTicket, hasTicketSpaceClearance } from '@/lib/security/permissions';
import { toast } from '@/components/ui/toast';

function getInitials(name?: string | null) {
  if (!name) return 'U';
  const trimmed = name.trim();
  return trimmed.charAt(0).toUpperCase();
}

export interface TaskRecord {
  id: string;
  taskKey: string;
  title: string;
  description?: string | null;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  space: {
    id: string;
    name: string;
    key: string;
    slaPolicy?: {
      urgentHours: number;
      highHours: number;
      normalHours: number;
      lowHours: number;
    } | null;
  };
  list: { id: string; name: string };
  status: { id: string; name: string; color: string; order: number; isCompleted: boolean; isClosed: boolean };
  assignee?: { id: string; name: string; username: string; email: string } | null;
  createdBy: { id: string; name: string; username: string; email: string; homeDepartment?: string };
  creator?: { id?: string; name?: string; username?: string; email?: string; department?: string; role?: string; homeDepartment?: string };
  comments?: any[];
  _count?: { comments: number; attachments: number };
  collaboration?: TaskCollaborationInfo | null;
  checklistItems?: Array<{ id: string; title: string; isCompleted: boolean; order?: number }>;
  attachments?: Array<{ id: string; fileName: string; fileUrl: string; fileType: string; fileSize: number; uploadedBy?: { id: string; name: string; username: string } }>;
  customFieldValues?: Array<{ id: string; fieldId: string; value: string; field?: { id: string; name: string; fieldType: string; options?: string | null } }>;
  startDate?: string | null;
  dueDate?: string | null;
  isMilestone?: boolean;
  dependsOnIds?: string | null;
  progress?: number;
}

interface ListViewProps {
  tasks: TaskRecord[];
  statuses: TaskStatusItem[];
  currentUser: AuthenticatedUser;
  onUpdateStatus: (taskId: string, newStatusId: string) => Promise<void>;
  onUpdatePriority: (taskId: string, newPriority: string) => Promise<void>;
  onAssignToMe: (taskId: string) => Promise<void>;
  onTaskClick?: (task: TaskRecord) => void;
  compact?: boolean;
  spaceId?: string;
  onHandoffComplete?: (task: any, action: 'CLOSE' | 'TRANSFER') => void;
  onStatusRenamed?: (statusId: string, newName: string) => void;
}

const PRIORITY_CONFIG = {
  URGENT: {
    label: 'Urgent',
    badge: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/30',
    textColor: 'text-rose-600 dark:text-rose-400',
  },
  HIGH: {
    label: 'High',
    badge: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/30',
    textColor: 'text-amber-600 dark:text-amber-400',
  },
  NORMAL: {
    label: 'Normal',
    badge: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/30',
    textColor: 'text-blue-600 dark:text-blue-400',
  },
  LOW: {
    label: 'Low',
    badge: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/15 dark:text-slate-400 dark:border-slate-500/30',
    textColor: 'text-slate-500 dark:text-slate-400',
  },
};

const PRIORITY_SELECT_STYLES: Record<string, string> = {
  URGENT:
    'text-rose-700 border-rose-200 bg-rose-50 hover:bg-rose-100 dark:text-rose-400 dark:border-rose-500/30 dark:bg-rose-500/15 dark:hover:bg-rose-500/25',
  HIGH:
    'text-amber-700 border-amber-200 bg-amber-50 hover:bg-amber-100 dark:text-amber-400 dark:border-amber-500/30 dark:bg-amber-500/15 dark:hover:bg-amber-500/25',
  NORMAL:
    'text-blue-700 border-blue-200 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:border-blue-500/30 dark:bg-blue-500/15 dark:hover:bg-blue-500/25',
  LOW:
    'text-slate-600 border-slate-200 bg-slate-100 hover:bg-slate-200 dark:text-slate-300 dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.08]',
};

export function ListView({
  tasks,
  statuses,
  currentUser,
  onUpdateStatus,
  onUpdatePriority,
  onAssignToMe,
  onTaskClick,
  compact = false,
  spaceId: spaceIdProp,
  onHandoffComplete,
  onStatusRenamed,
}: ListViewProps) {
  const rowPad = compact ? 'py-1.5' : 'py-2.5';

  const { currentSpace, spaces, refreshSpaces } = useWorkspace();
  const effectiveSpaceId = spaceIdProp || currentSpace?.id;

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

  // Resolution & Hand-off intercept state
  const [resolvingTicket, setResolvingTicket] = useState<TaskRecord | null>(null);

  const isResolutionStatus = (status?: TaskStatusItem | null) => {
    if (!status) return false;
    return (
      Boolean(status.isClosed) ||
      Boolean(status.isCompleted) ||
      status.category === 'RESOLVED' ||
      status.category === 'CLOSED' ||
      ['closed', 'resolved'].includes(status.name.toLowerCase()) ||
      /clos|resolv|done|finish/i.test(status.name)
    );
  };

  const handleStatusSelect = (ticket: TaskRecord, newStatusId: string) => {
    const currentMatchedId = getMatchingStatusId(ticket.status, statuses) || ticket.status.id;
    if (currentMatchedId === newStatusId) return;

    const canModify = canModifyTicket(currentUser, ticket, spaces);
    if (!canModify) {
      toast.error(
        'Permission Denied: Only department staff, assignees, or creators can modify this ticket.',
        'Clearance Denied'
      );
      return;
    }

    const selectedStatus = statuses.find((s) => s.id === newStatusId);
    if (!selectedStatus) return;

    // Resolve target status within the ticket's own space (matching BoardView logic)
    const targetSpaceId = (ticket as any).spaceId || ticket.space?.id;
    const targetSpace = spaces.find((s) => s.id === targetSpaceId);
    const targetCategory = getStatusCategory(selectedStatus);
    const targetStatusInSpace = targetSpace?.statuses?.find(
      (st) => getStatusCategory(st) === targetCategory
    );
    const resolvedTargetStatus = targetStatusInSpace || selectedStatus;

    onUpdateStatus(ticket.id, resolvedTargetStatus.id);
  };

  const handlePrioritySelect = (ticket: TaskRecord, newPriority: string) => {
    if (ticket.priority === newPriority) return;
    const canModify = canModifyTicket(currentUser, ticket, spaces);
    if (!canModify) {
      toast.error(
        'Permission Denied: Only department staff, assignees, or creators can modify this ticket.',
        'Clearance Denied'
      );
      return;
    }
    onUpdatePriority(ticket.id, newPriority);
  };

  const handleAssignClick = (ticket: TaskRecord) => {
    const canModify = canModifyTicket(currentUser, ticket, spaces);
    if (!canModify) {
      toast.error(
        'Permission Denied: Only department staff or Superadmins can modify this ticket.',
        'Clearance Denied'
      );
      return;
    }
    onAssignToMe(ticket.id);
  };

  // Collapsed status groups state
  const [collapsedStatusIds, setCollapsedStatusIds] = useState<string[]>([]);

  const toggleStatusGroup = (statusId: string) => {
    setCollapsedStatusIds((prev) =>
      prev.includes(statusId)
        ? prev.filter((id) => id !== statusId)
        : [...prev, statusId]
    );
  };

  // Group tasks by status ID or canonical category match
  const tasksByStatus = new Map<string, TaskRecord[]>();
  for (const st of statuses) {
    tasksByStatus.set(st.id, []);
  }

  // Also collect tasks whose status might not be in the current Space statuses
  const uncategorizedTasks: TaskRecord[] = [];
  for (const t of tasks) {
    const matchedStatusId = getMatchingStatusId(t.status, statuses);
    if (matchedStatusId && tasksByStatus.has(matchedStatusId)) {
      tasksByStatus.get(matchedStatusId)!.push(t);
    } else {
      uncategorizedTasks.push(t);
    }
  }

  return (
    <div className="space-y-6 select-none">
      {statuses.map((status) => {
        const statusTasks = tasksByStatus.get(status.id) || [];
        const isCollapsed = collapsedStatusIds.includes(status.id);
        const displayName = optimisticNames[status.id] || status.name;
        const statusColor = getCanonicalStatusColor(status);

        return (
          <div key={status.id} className="space-y-1.5">
            {/* 1. Status Section Header */}
            <div className="flex items-center gap-2 px-2 py-1">
              <button
                type="button"
                onClick={() => toggleStatusGroup(status.id)}
                className="p-1 text-zinc-500 hover:text-zinc-200 rounded transition-colors cursor-pointer shrink-0"
              >
                {isCollapsed ? (
                  <ChevronRight className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>

              {editingStatusId === status.id ? (
                <div
                  className="relative flex items-center gap-1.5 px-2 py-0.5 rounded border shadow-inner"
                  style={{
                    backgroundColor: `${statusColor}15`,
                    borderColor: statusColor,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: statusColor }}
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
                    className="text-xs font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white dark:bg-zinc-800 border border-blue-500 text-zinc-900 dark:text-zinc-100 outline-none ring-1 ring-blue-500/50 shadow-inner w-36"
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
                  {statusSaveError && (
                    <div className="absolute top-full left-0 z-20 mt-1 px-2 py-1 rounded bg-red-600 text-[10px] font-medium text-white shadow-md whitespace-nowrap">
                      {statusSaveError}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 group/status-header">
                  <div
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
                      'px-2.5 py-0.5 rounded text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 border transition-all',
                      canEditStatus(status) && 'cursor-pointer hover:brightness-110'
                    )}
                    style={{
                      backgroundColor: `${statusColor}20`,
                      borderColor: `${statusColor}50`,
                      color: statusColor,
                    }}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: statusColor }}
                    />
                    <span>{displayName}</span>
                  </div>

                  {canEditStatus(status) && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStartEditing(status);
                      }}
                      title="Rename status"
                      className="opacity-0 group-hover/status-header:opacity-100 p-0.5 text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 transition-opacity rounded cursor-pointer shrink-0"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}

              <span className="text-xs font-mono text-zinc-500 font-medium">
                {statusTasks.length} {statusTasks.length === 1 ? 'task' : 'tasks'}
              </span>
            </div>

            {/* 2. Status Group Table */}
            {!isCollapsed && (
              <div className="bg-[#F0F4FA] border border-[#C8D5E6] dark:bg-zinc-900/60 dark:border-zinc-800/80 rounded-xl overflow-hidden shadow-xs">
                {statusTasks.length === 0 ? (
                  <div className="py-4 text-center text-xs text-[#475569] dark:text-zinc-500 italic">
                    No tickets currently in {displayName}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full table-fixed border-collapse text-left text-xs min-w-[1050px]">
                      <colgroup>
                        <col className="w-[40px]" />
                        <col className="w-[100px]" />
                        <col className="w-[38%] min-w-[320px]" />
                        <col className="w-[20%] min-w-[190px]" />
                        <col className="w-[130px]" />
                        <col className="w-[115px]" />
                        <col className="w-[140px]" />
                        <col className="w-[90px]" />
                      </colgroup>
                      <thead className="bg-[#D8E1EE] text-[#0F172A] font-mono text-[10px] uppercase border-b border-[#C4D1E2] dark:bg-zinc-950/80 dark:text-zinc-400 dark:border-zinc-800/80">
                        <tr>
                          <th className="w-[40px] px-3 py-2 text-center text-[11px] font-semibold text-[#475569] dark:text-zinc-400 uppercase tracking-wider whitespace-nowrap">
                            #
                          </th>
                          <th className="w-[100px] px-3 py-2 text-left text-[11px] font-semibold text-[#475569] dark:text-zinc-400 uppercase tracking-wider whitespace-nowrap font-mono text-xs">
                            Ticket Key
                          </th>
                          <th className="w-[38%] min-w-[320px] px-4 py-2 text-left text-[11px] font-semibold text-[#475569] dark:text-zinc-400 uppercase tracking-wider">
                            Title &amp; Queue
                          </th>
                          <th className="w-[20%] min-w-[190px] px-4 py-2 text-left text-[11px] font-semibold text-[#475569] dark:text-zinc-400 uppercase tracking-wider">
                            Employee / Dept
                          </th>
                          <th className="w-[130px] px-3 py-2 text-left text-[11px] font-semibold text-[#475569] dark:text-zinc-400 uppercase tracking-wider whitespace-nowrap">
                            Status
                          </th>
                          <th className="w-[115px] px-3 py-2 text-left text-[11px] font-semibold text-[#475569] dark:text-zinc-400 uppercase tracking-wider whitespace-nowrap">
                            Priority
                          </th>
                          <th className="w-[140px] px-3 py-2 text-left text-[11px] font-semibold text-[#475569] dark:text-zinc-400 uppercase tracking-wider whitespace-nowrap">
                            Assignee
                          </th>
                          <th className="w-[90px] px-3 py-2 text-right text-[11px] font-semibold text-[#475569] dark:text-zinc-400 uppercase tracking-wider whitespace-nowrap">
                            Created
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#C8D5E6] dark:divide-zinc-800/50">
                        {statusTasks.map((task, idx) => {
                          const priorityInfo =
                            PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.NORMAL;
                          const slaEval = evaluateTaskSla(
                            task.createdAt,
                            task.priority,
                            task.status.isCompleted || task.status.isClosed,
                            task.space?.slaPolicy
                          );
                          const isBreached = !!slaEval?.isBreached;
                          const creator = task.creator || task.createdBy;
                          const creatorName = creator?.name || creator?.username || 'Unknown';
                          const creatorDept =
                            (creator as any)?.department ||
                            (creator as any)?.role ||
                            (creator as any)?.homeDepartment ||
                            'Employee';
                          const commentCount = task._count?.comments ?? task.comments?.length ?? 0;
                          const canModify = hasTicketSpaceClearance(currentUser, task.space?.id, spaces);
                          const matchedStatusId = getMatchingStatusId(task.status, statuses) || task.status.id;

                          return (
                            <tr
                              key={task.id}
                              className="hover:bg-[#F5F8FD] dark:hover:bg-zinc-800/40 transition-colors group cursor-pointer"
                              onClick={() => onTaskClick?.(task)}
                            >
                              {/* Row index / Drag placeholder */}
                              <td className="w-[40px] px-3 py-3 align-middle text-center text-[#64748B] dark:text-zinc-600 font-mono text-[11px] whitespace-nowrap">
                                {idx + 1}
                              </td>

                              {/* Ticket Key */}
                              <td className="w-[100px] px-3 py-3 align-middle font-mono font-semibold text-[#1E3A8A] dark:text-zinc-300 whitespace-nowrap text-xs">
                                <span className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                                  {task.taskKey}
                                </span>
                              </td>

                              {/* Title & Queue */}
                              <td className="w-[38%] min-w-[320px] px-4 py-3 pr-5 overflow-hidden align-middle">
                                <div className="flex flex-col gap-1.5 min-w-0 max-w-full overflow-hidden">
                                  {/* Row 1 (Primary Title — 100% Width) */}
                                  <span
                                    title={task.title}
                                    className="text-sm font-medium text-[#0F172A] group-hover:text-blue-600 dark:text-zinc-100 dark:group-hover:text-blue-400 transition-colors truncate block w-full min-w-0 max-w-full break-words [overflow-wrap:anywhere]"
                                  >
                                    {task.title}
                                  </span>

                                  {/* Row 2 (Compact Metadata & Status Pills) */}
                                  <div className="flex flex-wrap items-center gap-1.5 min-w-0 max-w-full text-[11px]">
                                    {/* 1. Department Badge */}
                                    {task.space?.key && (
                                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#DFECFA] text-[#1D4ED8] border border-[#B9D3F3] dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/30 whitespace-nowrap shrink-0">
                                        {task.space.key}
                                      </span>
                                    )}

                                    {/* 2. Queue / List Pill */}
                                    {task.list?.name && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#E5ECF6] text-[#1E293B] border border-[#CBD7E8] dark:bg-white/[0.04] dark:text-slate-300 dark:border-white/10 whitespace-nowrap shrink-0">
                                        {task.list.name}
                                      </span>
                                    )}

                                    {/* 3. Contributed Handoff Badge */}
                                    {task.collaboration?.isCollaborated && (
                                      <span
                                        className="text-[10px] px-1.5 py-0.5 font-medium rounded bg-[#E3EDF9] text-[#1E40AF] border border-[#BFD2EC] dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/25 whitespace-nowrap inline-flex items-center gap-1 shrink-0"
                                        title={`Collaboration Route: ${task.collaboration.routeStr} (Sitting in: ${task.collaboration.currentSpace.name}, Origin: ${task.collaboration.originSpace?.name || 'Unknown'})`}
                                      >
                                        <GitPullRequest className="w-2.5 h-2.5 shrink-0" />
                                        <span>{task.collaboration.routeStr || 'Contributed'}</span>
                                      </span>
                                    )}

                                    {/* 4. SLA Warning / Breached Pill */}
                                    {isBreached && (
                                      <span
                                        data-tour="sla-badge"
                                        className="text-[10px] px-1.5 py-0.5 font-medium rounded bg-[#F9E8EC] text-[#BE123C] border border-[#F1C4D0] dark:bg-red-500/15 dark:text-red-400 dark:border-red-500/30 whitespace-nowrap inline-flex items-center gap-1 shrink-0"
                                        title={`SLA Breached: ${slaEval?.label || 'Breached'}`}
                                      >
                                        <AlertCircle className="w-2.5 h-2.5 text-[#BE123C] dark:text-red-400 animate-pulse shrink-0" />
                                        <span>SLA Breached</span>
                                      </span>
                                    )}

                                    {slaEval?.isWatch && (
                                      <span
                                        data-tour="sla-badge"
                                        className="text-[10px] px-1.5 py-0.5 font-medium rounded bg-[#FEF3E2] text-[#B45309] border border-[#FCD8A5] dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/30 whitespace-nowrap inline-flex items-center gap-1 shrink-0"
                                        title={`SLA Watch: ${Math.round(slaEval.percentElapsed)}% elapsed (${slaEval.thresholdHours}h limit)`}
                                      >
                                        <Clock className="w-2.5 h-2.5 text-[#B45309] dark:text-amber-400 shrink-0" />
                                        <span>SLA Watch</span>
                                      </span>
                                    )}

                                    {/* 5. Checklist Progress */}
                                    {(() => {
                                      const total = task.checklistItems?.length || 0;
                                      if (total === 0) return null;
                                      const completed = task.checklistItems?.filter((c) => c.isCompleted).length || 0;
                                      const isAllDone = completed === total;
                                      return (
                                        <span
                                          className={cn(
                                            'inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0',
                                            isAllDone
                                              ? 'text-[#065F46] bg-[#E1F4E9] border-[#B2E5C5] dark:text-emerald-400 dark:bg-emerald-950/40 dark:border-emerald-800/50'
                                              : 'text-[#1E293B] bg-[#E5ECF6] border-[#CBD7E8] dark:text-slate-300 dark:bg-white/[0.04] dark:border-white/10'
                                          )}
                                          title={`Checklist: ${completed}/${total} completed`}
                                        >
                                          <CheckSquare className="w-3 h-3 shrink-0" />
                                          <span>{completed}/{total}</span>
                                        </span>
                                      );
                                    })()}

                                    {/* Attachment Count */}
                                    {(() => {
                                      const count = (task.attachments?.length || 0) > 0
                                        ? task.attachments!.length
                                        : (task._count?.attachments || 0);
                                      if (count === 0) return null;
                                      return (
                                        <span
                                          className="inline-flex items-center gap-1 text-[10px] text-[#1E293B] dark:text-slate-300 font-mono px-1.5 py-0.5 rounded bg-[#E5ECF6] dark:bg-white/[0.04] border border-[#CBD7E8] dark:border-white/10 shrink-0"
                                          title={`${count} attachment${count > 1 ? 's' : ''}`}
                                        >
                                          <Paperclip className="w-3 h-3 shrink-0" />
                                          <span>{count}</span>
                                        </span>
                                      );
                                    })()}

                                    {/* Comments Count */}
                                    {commentCount > 0 && (
                                      <span
                                        className="inline-flex items-center gap-1 text-[10px] text-[#1E293B] dark:text-slate-300 font-mono px-1.5 py-0.5 rounded bg-[#E5ECF6] dark:bg-white/[0.04] border border-[#CBD7E8] dark:border-white/10 shrink-0"
                                        title={`${commentCount} comment${commentCount > 1 ? 's' : ''}`}
                                      >
                                        <MessageSquare className="w-3 h-3 shrink-0" />
                                        <span>{commentCount}</span>
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>

                              {/* EMPLOYEE / DEPT */}
                              <td className="w-[20%] min-w-[190px] px-4 py-3 overflow-hidden align-middle">
                                <div className="flex items-center gap-2.5 min-w-0 max-w-full">
                                  {/* Avatar */}
                                  <div className="w-7 h-7 rounded-full bg-[#D8E1EE] border border-[#C4D1E2] text-[#0F172A] dark:bg-emerald-950/70 dark:border-emerald-700/60 dark:text-emerald-300 text-xs font-bold flex items-center justify-center shrink-0">
                                    {getInitials(creatorName)}
                                  </div>

                                  {/* Name & Role/Dept */}
                                  <div className="flex flex-col min-w-0 overflow-hidden leading-tight gap-0.5">
                                    <span className="text-xs font-medium text-[#0F172A] dark:text-zinc-200 truncate" title={creatorName}>
                                      {creatorName}
                                    </span>
                                    {task.collaboration?.isCollaborated ? (
                                      <span
                                        className="text-[11px] text-[#1E40AF] dark:text-amber-400 font-medium truncate"
                                        title={`Current Location: ${task.collaboration.currentSpace.name} | Originating Department: ${task.collaboration.originSpace?.name || creatorDept}`}
                                      >
                                        📍 {task.collaboration.currentSpace.name} · from {task.collaboration.originSpace?.name || creatorDept}
                                      </span>
                                    ) : (
                                      <span className="text-[11px] text-[#475569] dark:text-zinc-400 truncate" title={creatorDept}>
                                        {creatorDept}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>

                              {/* Status Native Select */}
                              <td
                                className="w-[130px] px-3 py-3 align-middle whitespace-nowrap"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="relative w-full">
                                  {(() => {
                                    const baseStatuses = statuses && statuses.length > 0 ? statuses : CANONICAL_STATUSES;
                                    const hasMatched = baseStatuses.some((st) => st.id === matchedStatusId);
                                    const displayStatuses = hasMatched
                                      ? baseStatuses
                                      : [
                                          ...baseStatuses,
                                          {
                                            id: matchedStatusId,
                                            name: task.status?.name || 'Current Status',
                                            color: getCanonicalStatusColor(task.status),
                                            order: 99,
                                            isCompleted: Boolean(task.status?.isCompleted),
                                            isClosed: Boolean(task.status?.isClosed),
                                          },
                                        ];

                                    return (
                                      <select
                                        value={matchedStatusId}
                                        disabled={!canModify}
                                        title={!canModify ? 'Only department staff or Superadmins can update status' : 'Change status'}
                                        onChange={(e) => {
                                          e.stopPropagation();
                                          handleStatusSelect(task, e.target.value);
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        className={cn(
                                          'h-7 w-full pl-2.5 pr-6 appearance-none border rounded-md text-xs font-medium truncate transition-colors',
                                          canModify
                                            ? 'bg-[#F3F6FB] dark:bg-zinc-900 border-[#C4D2E4] dark:border-zinc-700/80 text-[#0F172A] dark:text-zinc-200 cursor-pointer hover:bg-[#F7F9FD] dark:hover:bg-zinc-800 focus:outline-none focus:ring-1 focus:ring-indigo-500'
                                            : 'bg-[#D8E1EE]/60 dark:bg-zinc-900/40 border-[#C4D1E2] dark:border-zinc-800 text-[#64748B] dark:text-zinc-500 cursor-not-allowed opacity-75'
                                        )}
                                      >
                                        {displayStatuses.map((st) => (
                                          <option
                                            key={st.id}
                                            value={st.id}
                                            className="bg-[#F0F4FA] dark:bg-zinc-900 text-[#0F172A] dark:text-zinc-200 font-medium"
                                          >
                                            {optimisticNames[st.id] || st.name}
                                          </option>
                                        ))}
                                      </select>
                                    );
                                  })()}
                                  <ChevronDown className="w-3.5 h-3.5 text-[#64748B] pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 shrink-0" />
                                </div>
                              </td>

                              {/* Priority Native Select */}
                              <td
                                className="w-[115px] px-3 py-3 align-middle whitespace-nowrap"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="relative w-full">
                                  <select
                                    value={task.priority}
                                    disabled={!canModify}
                                    title={!canModify ? 'Only department staff or Superadmins can update priority' : 'Change priority'}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      handlePrioritySelect(task, e.target.value);
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className={cn(
                                      'h-7 w-full pl-2 pr-6 appearance-none border rounded-md text-[11px] font-semibold uppercase transition-colors',
                                      canModify
                                        ? `cursor-pointer hover:bg-[#F7F9FD] dark:hover:bg-zinc-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                                            PRIORITY_SELECT_STYLES[task.priority] || PRIORITY_SELECT_STYLES.NORMAL
                                          }`
                                        : 'bg-[#D8E1EE]/60 dark:bg-zinc-900/40 border-[#C4D1E2] dark:border-zinc-800 text-[#64748B] dark:text-zinc-500 cursor-not-allowed opacity-75'
                                    )}
                                  >
                                    {(['URGENT', 'HIGH', 'NORMAL', 'LOW'] as const).map((p) => (
                                      <option
                                        key={p}
                                        value={p}
                                        className="bg-[#F0F4FA] dark:bg-zinc-900 text-[#0F172A] dark:text-zinc-200 font-semibold"
                                      >
                                        {p}
                                      </option>
                                    ))}
                                  </select>
                                  <ChevronDown className="w-3 h-3 opacity-70 pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 shrink-0" />
                                </div>
                              </td>

                              {/* Assignee */}
                              <td
                                className="w-[140px] px-3 py-3 align-middle whitespace-nowrap"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {task.assignee ? (
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <div className="w-5 h-5 rounded-full bg-[#D8E1EE] dark:bg-zinc-800 border border-[#C4D1E2] dark:border-zinc-700 flex items-center justify-center text-[10px] font-bold text-[#0F172A] dark:text-zinc-200 shrink-0">
                                      {task.assignee.name.charAt(0).toUpperCase()}
                                    </div>
                                    <span className="text-[#0F172A] dark:text-zinc-200 truncate text-xs font-medium">
                                      {task.assignee.name}
                                    </span>
                                  </div>
                                ) : canModify ? (
                                  <button
                                    type="button"
                                    onClick={() => handleAssignClick(task)}
                                    className="text-xs text-[#1D4ED8] hover:text-[#1E40AF] dark:hover:text-blue-400 hover:underline cursor-pointer font-medium"
                                  >
                                    + Assign to Me
                                  </button>
                                ) : (
                                  <span className="text-xs text-[#64748B] dark:text-zinc-500 italic">
                                    Unassigned
                                  </span>
                                )}
                              </td>

                              {/* Created Date */}
                              <td className="w-[90px] px-3 py-3 align-middle whitespace-nowrap text-right text-[#64748B] font-mono text-[11px]">
                                {new Date(task.createdAt).toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Uncategorized section if any */}
      {uncategorizedTasks.length > 0 && (
        <div className="space-y-1.5 pt-4">
          <div className="flex items-center gap-2 px-2 py-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Other Department Tasks ({uncategorizedTasks.length})
            </span>
          </div>
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3">
            {uncategorizedTasks.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between py-1 text-xs"
              >
                <span className="font-mono font-bold text-zinc-300">
                  {t.taskKey}: {t.title}
                </span>
                <span className="text-zinc-500 font-mono">{t.space.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ticket Resolution & Cross-Department Hand-off Intercept Modal */}
      {resolvingTicket && (
        <TicketResolutionHandoffModal
          isOpen={Boolean(resolvingTicket)}
          onClose={() => setResolvingTicket(null)}
          task={{
            id: resolvingTicket.id,
            taskKey: resolvingTicket.taskKey,
            title: resolvingTicket.title,
            spaceId: resolvingTicket.space.id,
            space: resolvingTicket.space,
            listId: resolvingTicket.list.id,
            list: resolvingTicket.list,
          }}
          currentUser={currentUser}
          onSuccess={async (updatedTask, action) => {
            setResolvingTicket(null);
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
