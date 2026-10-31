'use client';

import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  AlertTriangle,
  Clock,
  GitPullRequest,
  Paperclip,
  CheckSquare,
} from 'lucide-react';
import { TaskRecord } from './ListView';
import { TaskStatusItem, SpaceItem } from '@/context/workspace-context';
import { AuthenticatedUser } from '@/lib/security/rbac';
import { evaluateTaskSla } from '@/lib/sla';
import { cn } from '@/lib/utils';
import { canModifyTicket } from '@/lib/security/permissions';
import { getCanonicalStatusColor } from '@/lib/status-utils';

export interface TaskCardProps {
  task: TaskRecord;
  currentUser: AuthenticatedUser;
  spaces?: SpaceItem[];
  isCompact?: boolean;
  isDragging?: boolean;
  isMutating?: boolean;
  prevStatus?: TaskStatusItem | null;
  nextStatus?: TaskStatusItem | null;
  onCardClick?: (task: TaskRecord) => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onMoveToStatus?: (taskId: string, targetStatus: TaskStatusItem) => void;
}

const PRIORITY_BADGES: Record<string, { label: string; style: string }> = {
  URGENT: { label: 'Urgent', style: 'bg-[#F9E8EC] text-[#BE123C] border border-[#F1C4D0] dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/30' },
  HIGH: { label: 'High', style: 'bg-[#FEF3E2] text-[#B45309] border border-[#FCD8A5] dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/30' },
  NORMAL: { label: 'Normal', style: 'bg-[#DFECFA] text-[#1D4ED8] border border-[#B9D3F3] dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/30' },
  LOW: { label: 'Low', style: 'bg-[#E5ECF6] text-[#334155] border border-[#CBD7E8] dark:bg-slate-500/15 dark:text-slate-400 dark:border-slate-500/30' },
};

export function TaskCard({
  task,
  currentUser,
  spaces = [],
  isCompact = false,
  isDragging = false,
  isMutating = false,
  prevStatus,
  nextStatus,
  onCardClick,
  onDragStart,
  onDragEnd,
  onMoveToStatus,
}: TaskCardProps) {
  const pBadge = PRIORITY_BADGES[task.priority] || PRIORITY_BADGES.NORMAL;
  const canModify = canModifyTicket(currentUser, task, spaces);

  const slaEval = evaluateTaskSla(
    task.createdAt,
    task.priority,
    task.status?.isCompleted || task.status?.isClosed,
    task.space?.slaPolicy
  );

  return (
    <div
      draggable={true}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', task.id);
        onDragStart?.(e);
      }}
      onDragEnd={onDragEnd}
      onClick={() => onCardClick?.(task)}
      title={!canModify ? 'Only department staff, assignees, or creators can update status' : undefined}
      className={cn(
        'p-3 pl-3.5 flex flex-col gap-2 rounded-lg bg-[#F0F4FA] hover:bg-[#F5F8FD] border border-[#C6D4E6] hover:border-[#3B82F6] shadow-[0_2px_5px_rgba(15,23,42,0.05)] dark:bg-[#181C26] dark:border-white/10 dark:hover:border-zinc-700/80 transition-all duration-150 group select-none relative cursor-grab active:cursor-grabbing min-w-0 max-w-full overflow-hidden',
        isDragging && 'opacity-40 scale-[0.98]',
        isMutating && 'pointer-events-none'
      )}
    >
      {/* 3px Colored Left Status/Priority Accent Bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l"
        style={{ backgroundColor: getCanonicalStatusColor(task.status) }}
      />

      {/* 1. Top Metadata & Badge Row */}
      <div className="flex items-center justify-between gap-1.5 w-full min-w-0">
        {/* Left Group */}
        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#DFECFA] text-[#1D4ED8] border border-[#B9D3F3] dark:bg-blue-950/60 dark:text-blue-400 dark:border-blue-800/50 flex-shrink-0 font-mono">
            {task.space?.key || 'MIS'}
          </span>
          <span className="text-xs font-mono font-medium text-[#0F172A] dark:text-zinc-300 truncate">
            {task.taskKey}
          </span>
          {task.list?.name && (
            <span className="text-[11px] text-[#475569] dark:text-zinc-400 truncate max-w-[80px] hidden sm:inline" title={task.list.name}>
              &bull; {task.list.name}
            </span>
          )}
        </div>

        {/* Right Badge: Priority Pill */}
        <span
          className={cn(
            'text-[10px] font-bold px-1.5 py-0.5 rounded tracking-wide uppercase border flex-shrink-0 font-mono',
            pBadge.style
          )}
        >
          {pBadge.label}
        </span>
      </div>

      {/* 2. Title Typography */}
      <h4
        className={cn(
          'text-xs font-semibold tracking-tight text-[#0F172A] dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-white leading-snug break-words [overflow-wrap:anywhere] min-w-0 max-w-full mt-0.5',
          isCompact ? 'line-clamp-1' : 'line-clamp-2'
        )}
      >
        {task.title}
      </h4>

      {/* 3. Collaboration & Route Box ("Contributed") */}
      {task.collaboration?.isCollaborated && (
        <div className="rounded-md bg-[#E3EDF9] border border-[#BFD2EC] dark:bg-amber-500/10 dark:border-amber-500/25 p-2 text-[11px] flex flex-col gap-1">
          <div className="flex items-center gap-1.5 font-medium text-[#1E40AF] dark:text-amber-300">
            <GitPullRequest className="w-3.5 h-3.5 shrink-0 text-[#1E40AF] dark:text-amber-400" />
            <span className="truncate">{task.collaboration.routeStr || 'Contributed'}</span>
          </div>
          <div className="flex items-center justify-between text-[10px] text-[#334155] dark:text-amber-200/80 gap-1 pt-0.5">
            <span className="flex items-center gap-1 truncate">
              <span className="text-[#1E40AF] dark:text-amber-400 font-medium">
                📍 {task.space?.name || task.collaboration.currentSpace?.name || 'MIS'}
              </span>
            </span>
            <span className="truncate text-right text-[#334155] dark:text-amber-200/80">
              From: <strong className="text-[#0F172A] dark:text-zinc-300 font-medium">{task.collaboration.originSpace?.name || 'External'}</strong>
            </span>
          </div>
        </div>
      )}

      {/* 4. Creator / Requester Row */}
      <div className="text-[11px] bg-[#E5ECF6] border border-[#CBD7E8] text-[#1E293B] dark:bg-white/[0.04] dark:border-white/10 dark:text-slate-200 px-2 py-1 rounded flex items-center justify-between gap-2 min-w-0 overflow-hidden">
        <span className="font-semibold text-[#0F172A] dark:text-zinc-300 truncate min-w-0 flex-1" title={task.createdBy?.name}>
          {task.createdBy?.name || 'Unknown'}
        </span>
        <span className="flex-shrink-0 text-[#475569] dark:text-zinc-500 text-[10px] text-right font-medium" title={task.createdBy?.homeDepartment || 'Employee'}>
          {task.createdBy?.homeDepartment || 'Employee'}
        </span>
      </div>

      {/* 5. SLA Alert Pill (if present) */}
      {(() => {
        if (slaEval?.isBreached) {
          return (
            <div
              className="flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded border w-full bg-[#F9E8EC] text-[#BE123C] border-[#F1C4D0] dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30"
              title={`SLA Target Breached: ${slaEval.label}`}
            >
              <AlertTriangle className="w-3 h-3 text-[#BE123C] dark:text-rose-400 shrink-0 animate-pulse" />
              <span className="truncate">SLA Breached ({Math.floor(slaEval.elapsedHours)}h)</span>
            </div>
          );
        }

        if (slaEval?.isWatch) {
          return (
            <div
              className="flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded border w-full bg-[#FEF3E2] text-[#B45309] border-[#FCD8A5] dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800/50"
              title={`SLA Watch: ${Math.round(slaEval.percentElapsed)}% (${slaEval.thresholdHours}h limit) elapsed`}
            >
              <Clock className="w-3 h-3 text-[#B45309] dark:text-amber-400 shrink-0" />
              <span className="truncate">SLA Watch ({Math.round(slaEval.percentElapsed)}%)</span>
            </div>
          );
        }

        if (task.priority === 'URGENT') {
          return (
            <div className="flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded border w-full bg-[#F9E8EC] text-[#BE123C] border-[#F1C4D0] dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800/50">
              <AlertTriangle className="w-3 h-3 text-[#BE123C] dark:text-rose-400 shrink-0" />
              <span className="truncate">SLA Urgent Priority</span>
            </div>
          );
        }

        if (task.priority === 'HIGH') {
          return (
            <div className="flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded border w-full bg-[#FEF3E2] text-[#B45309] border-[#FCD8A5] dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800/50">
              <Clock className="w-3 h-3 text-[#B45309] dark:text-amber-400 shrink-0" />
              <span className="truncate">SLA High Priority</span>
            </div>
          );
        }

        return null;
      })()}

      {/* Custom Field Micro-Pills */}
      {(() => {
        const displayCustomFields = (task.customFieldValues || [])
          .filter((cf) => cf.value !== null && cf.value !== undefined && String(cf.value).trim() !== '')
          .slice(0, 2);

        if (displayCustomFields.length === 0) return null;

        return (
          <div className="flex flex-wrap items-center gap-1 pt-0.5">
            {displayCustomFields.map((cf) => {
              const isCurrency = cf.field?.fieldType === 'CURRENCY';
              const numVal = Number(cf.value);
              const displayVal = isCurrency
                ? `₱${!isNaN(numVal) ? numVal.toLocaleString() : cf.value}`
                : cf.value;
              return (
                <span
                  key={cf.id || cf.fieldId}
                  title={`${cf.field?.name || 'Field'}: ${cf.value}`}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-[#E5ECF6] border border-[#CBD7E8] text-[#1E293B] dark:bg-zinc-800/80 dark:text-zinc-300 dark:border-zinc-700/60 truncate max-w-full font-mono"
                >
                  {cf.field?.name ? `${cf.field.name}: ` : ''}{displayVal}
                </span>
              );
            })}
          </div>
        );
      })()}

      {/* 6. Card Footer (Avatars, Comments & Arrows) */}
      <div className="flex items-center justify-between pt-1.5 border-t border-[#C8D5E6] dark:border-zinc-800/40 text-[#475569] dark:text-zinc-400 text-[11px] mt-auto">
        {/* Left Group */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
          {task.assignee ? (
            <div
              className="w-5 h-5 rounded-full bg-[#D8E1EE] dark:bg-zinc-800 text-[10px] font-bold text-[#0F172A] dark:text-zinc-300 flex items-center justify-center border border-[#C4D1E2] dark:border-zinc-700/60 shrink-0"
              title={`Assigned to ${task.assignee.name}`}
            >
              {task.assignee.name.charAt(0).toUpperCase()}
            </div>
          ) : (
            <span className="text-[10px] text-[#475569] dark:text-zinc-500 shrink-0">
              Unassigned
            </span>
          )}

          {task._count?.comments !== undefined && task._count.comments > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-[#475569] hover:text-[#0F172A] dark:hover:text-zinc-200 font-mono ml-0.5 shrink-0">
              <MessageSquare className="w-3 h-3" />
              <span>{task._count.comments}</span>
            </span>
          )}

          {/* Checklist Counter Badge */}
          {(() => {
            const total = task.checklistItems?.length || 0;
            if (total === 0) return null;
            const completed = task.checklistItems?.filter((c) => c.isCompleted).length || 0;
            const isAllDone = completed === total;
            return (
              <span
                className={cn(
                  'flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0',
                  isAllDone
                    ? 'text-emerald-800 dark:text-emerald-400 bg-[#E1F4E9] border-[#B2E5C5] dark:bg-emerald-950/40 dark:border-emerald-800/50'
                    : 'text-[#1E293B] dark:text-zinc-400 bg-[#E5ECF6] border-[#CBD7E8] dark:bg-zinc-800/60 dark:border-zinc-700/50'
                )}
                title={`Checklist: ${completed}/${total} completed`}
              >
                <CheckSquare className="w-3 h-3" />
                <span>{completed}/{total}</span>
              </span>
            );
          })()}

          {/* Attachment Counter Badge */}
          {(() => {
            const count = (task.attachments?.length || 0) > 0
              ? task.attachments!.length
              : (task._count?.attachments || 0);
            if (count === 0) return null;
            return (
              <span
                className="flex items-center gap-1 text-[11px] text-[#475569] dark:text-zinc-400 hover:text-[#0F172A] dark:hover:text-zinc-200 font-mono shrink-0"
                title={`${count} attachment${count > 1 ? 's' : ''}`}
              >
                <Paperclip className="w-3 h-3" />
                <span>{count}</span>
              </span>
            );
          })()}
        </div>

        {/* Right Group: Navigation Chevrons / Quick Move */}
        {canModify && (prevStatus || nextStatus) && (
          <div
            className="flex items-center gap-1 text-zinc-400 flex-shrink-0 pl-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            {prevStatus && (
              <button
                type="button"
                onClick={() => onMoveToStatus?.(task.id, prevStatus)}
                title={`Move back to ${prevStatus.name}`}
                className="p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-slate-100 dark:text-zinc-500 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-3 h-3" />
              </button>
            )}
            {nextStatus && (
              <button
                type="button"
                onClick={() => onMoveToStatus?.(task.id, nextStatus)}
                title={`Advance to ${nextStatus.name}`}
                className="p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-slate-100 dark:text-zinc-500 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
