'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Check,
} from 'lucide-react';
import { TaskRecord } from './ListView';
import { TaskStatusItem } from '@/context/workspace-context';
import { AuthenticatedUser } from '@/lib/security/rbac';
import { getStatusCategory, getCanonicalStatusColor } from '@/lib/status-utils';
import { evaluateTaskSla } from '@/lib/sla';
import { cn } from '@/lib/utils';

export interface GanttViewProps {
  tasks: TaskRecord[];
  statuses: TaskStatusItem[];
  currentUser: AuthenticatedUser;
  onTaskClick?: (task: TaskRecord) => void;
  onUpdateDates?: (taskId: string, startDate: string, dueDate: string) => Promise<void>;
  onUpdateStatus?: (taskId: string, newStatusId: string) => Promise<any>;
  scale?: 'day' | 'week' | 'month';
  onScaleChange?: (scale: 'day' | 'week' | 'month') => void;
  milestonesOnly?: boolean;
}

const ROW_HEIGHT = 48; // h-12 per task track
const DAY_WIDTH = 48; // px per day column (w-12)
const WEEK_WIDTH = 140; // px per week in 'week' scale
const MONTH_WIDTH = 280; // px per month in 'month' scale

function getTaskProgress(task: TaskRecord): number {
  if (task.checklistItems && task.checklistItems.length > 0) {
    const done = task.checklistItems.filter((c) => c.isCompleted).length;
    return Math.round((done / task.checklistItems.length) * 100);
  }
  return typeof task.progress === 'number' ? task.progress : 0;
}

function normalizeDateOnly(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Maps task status, priority, and department to vibrant ClickUp capsule colors
 * fully aligned with the 5 platform canonical status colors:
 * - Open: Blue #3B82F6 (bg-blue-600)
 * - In Progress: Amber #F59E0B (bg-amber-500)
 * - Pending: Purple #8B5CF6 (bg-purple-600)
 * - Resolved: Emerald #10B981 (bg-emerald-500)
 * - Closed: Slate #6B7280 (bg-slate-500)
 */
function getCapsuleColor(task: TaskRecord, category: string): { bg: string; text: string; isLightText: boolean } {
  // 1. Closed -> Slate / Zinc (#6B7280)
  if (task.status?.isClosed || category === 'CLOSED') {
    return { bg: 'bg-slate-500', text: 'text-white', isLightText: true };
  }

  // 2. Resolved / Completed Tasks -> Green (Emerald #10B981)
  if (task.status?.isCompleted || category === 'RESOLVED') {
    return { bg: 'bg-emerald-500', text: 'text-white', isLightText: true };
  }

  // 3. Urgent / High Priority Tasks -> Coral / Magenta (Rose)
  if (task.priority === 'URGENT' || task.priority === 'HIGH') {
    return { bg: 'bg-rose-500', text: 'text-white', isLightText: true };
  }

  // 4. In Progress / Active Work -> Amber / Gold (#F59E0B)
  if (category === 'IN_PROGRESS') {
    return { bg: 'bg-amber-500', text: 'text-zinc-950', isLightText: false };
  }

  // 5. Pending / Waiting Tasks -> Purple (#8B5CF6)
  if (category === 'PENDING_USER') {
    return { bg: 'bg-purple-600', text: 'text-white', isLightText: true };
  }

  // 6. Open / Backlog -> Blue (#3B82F6)
  return { bg: 'bg-blue-600', text: 'text-white', isLightText: true };
}

export function GanttView({
  tasks,
  statuses,
  currentUser,
  onTaskClick,
  onUpdateDates,
  onUpdateStatus,
  scale = 'day',
  onScaleChange,
  milestonesOnly = false,
}: GanttViewProps) {
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);

  // Filter tasks based on milestonesOnly toggle
  const filteredTasks = useMemo(() => {
    if (!milestonesOnly) return tasks;
    return tasks.filter((t) => t.isMilestone);
  }, [tasks, milestonesOnly]);

  // Reference today
  const today = useMemo(() => normalizeDateOnly(new Date()), []);

  // Compute overall timeline date boundary
  const { timelineStart, timelineEnd, totalDays } = useMemo(() => {
    let minTime = today.getTime() - 4 * 86400000;
    let maxTime = today.getTime() + 21 * 86400000;

    for (const t of filteredTasks) {
      let s = t.startDate ? new Date(t.startDate).getTime() : NaN;
      if (isNaN(s)) s = t.createdAt ? new Date(t.createdAt).getTime() : NaN;
      if (isNaN(s)) s = today.getTime();
      let d = t.dueDate ? new Date(t.dueDate).getTime() : NaN;
      if (isNaN(d)) d = s + 3 * 86400000;
      if (!isNaN(s) && s < minTime) minTime = s;
      if (!isNaN(d) && d > maxTime) maxTime = d;
    }

    // Add padding: 3 days before min, 7 days after max
    const start = normalizeDateOnly(new Date(minTime - 3 * 86400000));
    const end = normalizeDateOnly(new Date(maxTime + 7 * 86400000));
    const days = Math.max(14, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);

    return { timelineStart: start, timelineEnd: end, totalDays: days };
  }, [filteredTasks, today]);

  // Column width by current scale
  const colWidth = scale === 'month' ? MONTH_WIDTH / 30 : scale === 'week' ? WEEK_WIDTH / 7 : DAY_WIDTH;

  // Build days array
  const daysList = useMemo(() => {
    const list: Date[] = [];
    for (let i = 0; i < totalDays; i++) {
      list.push(new Date(timelineStart.getTime() + i * 86400000));
    }
    return list;
  }, [timelineStart, totalDays]);

  // Two-Tier Header: Top Tier (Week Grouping, e.g. "19 OCT - 25 OCT")
  const weekGroups = useMemo(() => {
    const groups: { label: string; count: number; startIdx: number }[] = [];
    let currentWeekStart = 0;

    while (currentWeekStart < daysList.length) {
      const startDay = daysList[currentWeekStart];
      const count = Math.min(7, daysList.length - currentWeekStart);
      const endDay = daysList[currentWeekStart + count - 1];

      const startMonthStr = startDay.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
      const endMonthStr = endDay.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();

      const label =
        startMonthStr === endMonthStr
          ? `${startDay.getDate()} - ${endDay.getDate()} ${startMonthStr}`
          : `${startDay.getDate()} ${startMonthStr} - ${endDay.getDate()} ${endMonthStr}`;

      groups.push({
        label,
        count,
        startIdx: currentWeekStart,
      });

      currentWeekStart += count;
    }

    return groups;
  }, [daysList]);

  // Calculate task bar geometry
  const taskBars = useMemo(() => {
    return filteredTasks.map((task, rowIdx) => {
      let taskStart = task.startDate ? normalizeDateOnly(new Date(task.startDate)) : null;
      if (!taskStart || isNaN(taskStart.getTime())) {
        taskStart = task.createdAt ? normalizeDateOnly(new Date(task.createdAt)) : today;
      }
      if (isNaN(taskStart.getTime())) {
        taskStart = today;
      }

      let taskEnd = task.dueDate ? normalizeDateOnly(new Date(task.dueDate)) : null;
      if (!taskEnd || isNaN(taskEnd.getTime())) {
        taskEnd = new Date(taskStart.getTime() + 3 * 86400000);
      }
      if (isNaN(taskEnd.getTime()) || taskEnd < taskStart) {
        taskEnd = new Date(taskStart.getTime() + 86400000);
      }

      const startDiffDays = (taskStart.getTime() - timelineStart.getTime()) / 86400000;
      const durationDays = Math.max(1, Math.round((taskEnd.getTime() - taskStart.getTime()) / 86400000) + 1);

      const left = startDiffDays * colWidth;
      const rawWidth = durationDays * colWidth;
      const isMilestone = Boolean(task.isMilestone);
      const progress = getTaskProgress(task);
      const category = getStatusCategory(task.status);
      const slaEval = evaluateTaskSla(
        task.createdAt,
        task.priority,
        Boolean(task.status?.isCompleted || task.status?.isClosed),
        task.space?.slaPolicy
      );

      const isCompleted = Boolean(task.status?.isCompleted || task.status?.isClosed);
      const color = getCapsuleColor(task, category);

      return {
        task,
        rowIdx,
        taskStart,
        taskEnd,
        durationDays,
        left,
        width: Math.max(colWidth, rawWidth),
        isMilestone,
        progress,
        category,
        slaEval,
        isCompleted,
        color,
      };
    });
  }, [filteredTasks, timelineStart, colWidth]);

  // Today marker offset in pixels (exact center of today's column)
  const todayLeft = useMemo(() => {
    const diff = (today.getTime() - timelineStart.getTime()) / 86400000;
    return diff * colWidth + colWidth / 2;
  }, [today, timelineStart, colWidth]);

  // Auto-scroll timeline to Today on initial load & toolbar event
  useEffect(() => {
    if (timelineScrollRef.current) {
      const scrollPos = todayLeft - 320;
      timelineScrollRef.current.scrollLeft = Math.max(0, scrollPos);
    }

    const handleScrollToday = () => {
      if (timelineScrollRef.current) {
        const scrollPos = todayLeft - 320;
        timelineScrollRef.current.scrollTo({ left: Math.max(0, scrollPos), behavior: 'smooth' });
      }
    };

    window.addEventListener('gantt:scroll-today', handleScrollToday);
    return () => window.removeEventListener('gantt:scroll-today', handleScrollToday);
  }, [todayLeft]);

  // Quick nudge helper (-1d / +1d)
  const handleNudgeDates = async (
    e: React.MouseEvent,
    taskId: string,
    currentStart: Date,
    currentEnd: Date,
    days: number
  ) => {
    e.stopPropagation();
    if (!onUpdateDates) return;
    const newStart = new Date(currentStart.getTime() + days * 86400000);
    const newEnd = new Date(currentEnd.getTime() + days * 86400000);
    await onUpdateDates(
      taskId,
      newStart.toISOString().slice(0, 10),
      newEnd.toISOString().slice(0, 10)
    );
  };

  const timelineTotalWidth = Math.max(1200, totalDays * colWidth);
  const canvasHeight = Math.max(480, taskBars.length * ROW_HEIGHT + 120);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-slate-50 dark:bg-zinc-950/60 text-zinc-900 dark:text-zinc-100 select-none">
      {/* =========================================================================
          SINGLE-CANVAS CLICKUP-STYLE TIMELINE ARCHITECTURE
          Clean, distraction-free roadmap without dependency lines or dashed overlays
         ========================================================================= */}
      <div
        ref={timelineScrollRef}
        className="flex-1 min-h-0 overflow-auto bg-slate-50 dark:bg-zinc-950/60 relative"
      >
        {/* Invisible sticky guide anchor to guarantee sticky left alignment */}
        <div className="sticky left-0 pointer-events-none z-20" aria-hidden="true" />

        <div
          style={{ width: `${timelineTotalWidth}px`, minWidth: '100%', minHeight: `${canvasHeight}px` }}
          className="relative flex flex-col"
        >
          {/* =====================================================================
              1. STICKY TWO-TIER CALENDAR HEADER (TODAY BADGE SELF-CONTAINED INSIDE)
             ===================================================================== */}
          <div className="gantt-calendar-header h-[68px] flex-shrink-0 sticky top-0 z-20 border-b border-slate-200/80 dark:border-zinc-800/80 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md flex flex-col shadow-xs select-none">
            {/* Top Tier: Week Grouping (e.g. 19 OCT - 25 OCT) */}
            <div className="h-[28px] border-b border-slate-200/60 dark:border-zinc-800/60 flex items-center text-xs font-semibold text-zinc-600 dark:text-zinc-400 relative">
              {weekGroups.map((wg, i) => (
                <div
                  key={i}
                  style={{
                    left: `${wg.startIdx * colWidth}px`,
                    width: `${wg.count * colWidth}px`,
                  }}
                  className="absolute inset-y-0 flex items-center px-3 border-r border-slate-200/60 dark:border-zinc-800/60 text-[11px] font-semibold uppercase tracking-wider truncate text-zinc-600 dark:text-zinc-400"
                >
                  <Calendar className="w-3 h-3 mr-1.5 text-zinc-400 dark:text-zinc-500 shrink-0" />
                  <span>{wg.label}</span>
                </div>
              ))}
            </div>

            {/* Bottom Tier: Day Numbers (Centered above each 48px column) */}
            <div className="h-[40px] flex items-center text-xs font-mono text-zinc-500 dark:text-zinc-400 relative">
              {daysList.map((d, i) => {
                const isT = d.getTime() === today.getTime();
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;

                return (
                  <div
                    key={i}
                    style={{ left: `${i * colWidth}px`, width: `${colWidth}px` }}
                    className={cn(
                      'absolute inset-y-0 flex items-center justify-center border-r border-slate-200/50 dark:border-zinc-900/80',
                      isWeekend && !isT && 'bg-slate-200/20 dark:bg-zinc-900/30 text-zinc-400 dark:text-zinc-600'
                    )}
                  >
                    {isT ? (
                      /* Self-contained compact TODAY badge inside header cell */
                      <div className="flex flex-col items-center justify-center py-1">
                        <span className="text-[8px] font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-wider leading-none mb-0.5">
                          TODAY
                        </span>
                        <span className="w-5 h-5 rounded-full bg-indigo-600 text-white font-bold text-[11px] flex items-center justify-center shadow-sm shadow-indigo-500/40">
                          {d.getDate()}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                        {d.getDate()}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* =====================================================================
              2. BACKGROUND GRID & VERTICAL GUIDE LINES
             ===================================================================== */}
          <div className="relative flex-1" style={{ height: `${taskBars.length * ROW_HEIGHT + 60}px` }}>
            {/* Vertical Daily Grid Guide Lines (Extending down full canvas height) */}
            {daysList.map((d, i) => {
              const isT = d.getTime() === today.getTime();
              const isWeekend = d.getDay() === 0 || d.getDay() === 6;

              return (
                <div
                  key={i}
                  style={{ left: `${i * colWidth}px`, width: `${colWidth}px` }}
                  className={cn(
                    'absolute top-0 bottom-0 border-r border-slate-200/40 dark:border-zinc-900/80 pointer-events-none z-0',
                    isWeekend && !isT && 'bg-slate-200/10 dark:bg-zinc-900/20'
                  )}
                />
              );
            })}

            {/* Horizontal Track Rows */}
            {taskBars.map((_, rowIdx) => (
              <div
                key={rowIdx}
                style={{
                  top: `${rowIdx * ROW_HEIGHT}px`,
                  height: `${ROW_HEIGHT}px`,
                }}
                className="absolute inset-x-0 border-b border-slate-200/30 dark:border-zinc-900/50 pointer-events-none z-0"
              />
            ))}

            {/* ===================================================================
                3. VERTICAL "TODAY" BACKGROUND GUIDE LINE & COLUMN WASH (Z-0)
               =================================================================== */}
            {/* Subtle background wash across today's entire vertical column */}
            <div
              style={{
                left: `${todayLeft - colWidth / 2}px`,
                width: `${colWidth}px`,
              }}
              className="absolute top-0 bottom-0 bg-indigo-500/[0.04] dark:bg-indigo-500/[0.05] pointer-events-none z-0"
            />

            {/* Subtle refined vertical indicator line in background (z-0 behind task bars) */}
            <div
              style={{ left: `${todayLeft}px` }}
              className="absolute top-0 bottom-0 w-px bg-indigo-500/40 dark:bg-indigo-500/30 pointer-events-none z-0"
            />

            {/* ===================================================================
                4. VISUAL TASK CAPSULE BARS (Z-10 FOREGROUND ON TOP OF GRID)
               =================================================================== */}
            {taskBars.map((b) => {
              const {
                task,
                rowIdx,
                left,
                width,
                isMilestone,
                progress,
                isCompleted,
                color,
                taskStart,
                taskEnd,
              } = b;

              const isHovered = hoveredTaskId === task.id;
              // Center the 32px (h-8) capsule inside the 48px row
              const y = rowIdx * ROW_HEIGHT + (ROW_HEIGHT - 32) / 2;

              return (
                <div
                  key={task.id}
                  onClick={() => onTaskClick?.(task)}
                  onMouseEnter={() => setHoveredTaskId(task.id)}
                  onMouseLeave={() => setHoveredTaskId(null)}
                  style={{
                    left: `${left}px`,
                    width: `${width}px`,
                    top: `${y}px`,
                    height: '32px',
                  }}
                  className={cn(
                    'absolute z-10 rounded-full h-8 px-2 flex items-center gap-2 cursor-pointer shadow-md transition-all hover:scale-[1.01] group select-none',
                    color.bg,
                    color.text,
                    isHovered && 'z-30 shadow-lg ring-2 ring-white/60 dark:ring-zinc-400'
                  )}
                  title={`${task.taskKey} - ${task.title}\nStatus: ${task.status?.name}\nProgress: ${progress}%\nStart: ${taskStart.toLocaleDateString()}\nDue: ${taskEnd.toLocaleDateString()}`}
                >
                  {/* Subtle Internal Progress Fill */}
                  {progress > 0 && (
                    <div
                      style={{ width: `${progress}%` }}
                      className="absolute inset-y-0 left-0 bg-black/15 dark:bg-white/10 pointer-events-none rounded-full"
                    />
                  )}

                  {/* Left Status / Completion Indicator (Clean Circular White Badge) */}
                  <div
                    onClick={(e) => {
                      if (onUpdateStatus && !isMilestone) {
                        e.stopPropagation();
                        const targetStatus = isCompleted
                          ? statuses.find((s) => !s.isCompleted && !s.isClosed) || statuses[0]
                          : statuses.find((s) => s.isCompleted || s.isClosed) || statuses[statuses.length - 1];
                        if (targetStatus) {
                          onUpdateStatus(task.id, targetStatus.id);
                        }
                      }
                    }}
                    title={isCompleted ? 'Click to re-open' : 'Click to complete'}
                    className={cn(
                      "w-5 h-5 rounded-full bg-white flex items-center justify-center flex-shrink-0 shadow-sm z-10",
                      onUpdateStatus && !isMilestone && "cursor-pointer hover:scale-110 transition-transform"
                    )}
                  >
                    {isMilestone ? (
                      <div className="w-2.5 h-2.5 rotate-45 bg-amber-400 border border-zinc-950 shrink-0 shadow-2xs" />
                    ) : isCompleted ? (
                      <Check className="w-3 h-3 text-emerald-600 stroke-[3]" />
                    ) : (
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: getCanonicalStatusColor(task.status) }}
                      />
                    )}
                  </div>

                  {/* Task Key & Title Inside Bar */}
                  <div className="flex items-center gap-1.5 min-w-0 pr-3 z-10 truncate">
                    <span className="font-mono text-[11px] font-bold opacity-90 shrink-0">
                      {task.taskKey}
                    </span>
                    <span className="text-xs font-semibold truncate min-w-0">
                      {task.title}
                    </span>
                  </div>

                  {/* Floating Assignee Avatar (Overlapping Top Edge) */}
                  {task.assignee ? (
                    <div
                      className="absolute -top-2 right-4 w-6 h-6 rounded-full border-2 border-zinc-950 dark:border-zinc-900 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm text-[10px] font-bold flex items-center justify-center z-20 pointer-events-none select-none"
                      title={`Assignee: ${task.assignee.name}`}
                    >
                      {task.assignee.name.charAt(0).toUpperCase()}
                    </div>
                  ) : null}

                  {/* Quick -1d / +1d Schedule Nudge Buttons (Visible on Hover) */}
                  {onUpdateDates && isHovered && (
                    <div
                      className="absolute -bottom-6 right-2 flex items-center gap-0.5 bg-zinc-950/90 text-white rounded-md border border-zinc-700 px-1 py-0.5 shadow-lg z-40 text-[10px]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={(e) => handleNudgeDates(e, task.id, taskStart, taskEnd, -1)}
                        title="Shift 1 day earlier"
                        className="px-1 py-0.5 hover:bg-zinc-800 rounded cursor-pointer flex items-center gap-0.5"
                      >
                        <ChevronLeft className="w-3 h-3" />
                        <span>-1d</span>
                      </button>
                      <span className="text-zinc-600">|</span>
                      <button
                        type="button"
                        onClick={(e) => handleNudgeDates(e, task.id, taskStart, taskEnd, 1)}
                        title="Shift 1 day later"
                        className="px-1 py-0.5 hover:bg-zinc-800 rounded cursor-pointer flex items-center gap-0.5"
                      >
                        <span>+1d</span>
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Empty State */}
            {taskBars.length === 0 && (
              <div className="p-12 text-center text-xs text-zinc-500">
                No tickets match the selected criteria.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
