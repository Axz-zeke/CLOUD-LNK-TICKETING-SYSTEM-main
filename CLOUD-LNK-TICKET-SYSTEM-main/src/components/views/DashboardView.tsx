'use client';

import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Clock,
  CheckCircle2,
  GitPullRequest,
  Sparkles,
  Users,
  CheckSquare,
  TrendingUp,
  Building,
  Flag,
  ArrowRight,
  ShieldCheck,
  Link as LinkIcon,
} from 'lucide-react';
import { TaskRecord } from './ListView';
import { TaskStatusItem } from '@/context/workspace-context';
import { AuthenticatedUser } from '@/lib/security/rbac';
import { getStatusCategory } from '@/lib/status-utils';
import { evaluateTaskSla } from '@/lib/sla';
import { cn } from '@/lib/utils';

export interface DashboardViewProps {
  tasks: TaskRecord[];
  statuses: TaskStatusItem[];
  currentUser: AuthenticatedUser;
  onTaskClick?: (task: TaskRecord) => void;
  onUpdateStatus?: (taskId: string, newStatusId: string) => Promise<void>;
  onPriorityFilterClick?: (priority: string) => void;
}

function computeSla(task: TaskRecord) {
  return evaluateTaskSla(
    task.createdAt,
    task.priority,
    Boolean(task.status?.isCompleted || task.status?.isClosed),
    task.space?.slaPolicy
  );
}

export function DashboardView({
  tasks,
  statuses,
  currentUser,
  onTaskClick,
  onUpdateStatus,
  onPriorityFilterClick,
}: DashboardViewProps) {
  const [selectedPriorityFilter, setSelectedPriorityFilter] = useState<string | null>(null);

  // Compute Task KPIs
  const kpis = useMemo(() => {
    const total = tasks.length;
    let closedCount = 0;
    let openCount = 0;
    let inProgressCount = 0;
    let breachedCount = 0;
    let watchCount = 0;
    let collaboratedCount = 0;
    let totalChecklists = 0;
    let completedChecklists = 0;
    let totalMilestones = 0;
    let completedMilestones = 0;
    let totalAgeMs = 0;

    const now = Date.now();

    for (const t of tasks) {
      const cat = getStatusCategory(t.status);
      const isDone = t.status?.isCompleted || t.status?.isClosed || cat === 'RESOLVED' || cat === 'CLOSED';

      if (isDone) {
        closedCount++;
      } else {
        openCount++;
        if (cat === 'IN_PROGRESS' || cat === 'PENDING_USER') {
          inProgressCount++;
        }
        const createdMs = new Date(t.createdAt).getTime();
        if (!isNaN(createdMs)) {
          totalAgeMs += (now - createdMs);
        }
      }

      // SLA
      const sla = computeSla(t);
      if (sla?.isBreached) breachedCount++;
      else if (sla?.isWatch) watchCount++;

      // Collaborated
      if (t.collaboration?.isCollaborated) {
        collaboratedCount++;
      }

      // Checklists
      if (t.checklistItems && t.checklistItems.length > 0) {
        totalChecklists += t.checklistItems.length;
        completedChecklists += t.checklistItems.filter((c) => c.isCompleted).length;
      }

      // Milestones
      if (t.isMilestone) {
        totalMilestones++;
        if (isDone) completedMilestones++;
      }
    }

    const slaCompliancePct = total > 0 ? Math.round(((total - breachedCount) / total) * 100) : 100;
    const avgAgeHours = openCount > 0 ? Math.round(totalAgeMs / (openCount * 3600000)) : 0;
    const checklistPct = totalChecklists > 0 ? Math.round((completedChecklists / totalChecklists) * 100) : 0;

    return {
      total,
      openCount,
      closedCount,
      inProgressCount,
      avgAgeHours,
      breachedCount,
      watchCount,
      slaCompliancePct,
      collaboratedCount,
      totalChecklists,
      completedChecklists,
      checklistPct,
      totalMilestones,
      completedMilestones,
    };
  }, [tasks]);

  // Status Distribution
  const statusDistribution = useMemo(() => {
    const counts: Record<string, number> = {
      OPEN: 0,
      IN_PROGRESS: 0,
      PENDING_USER: 0,
      RESOLVED: 0,
      CLOSED: 0,
    };

    for (const t of tasks) {
      const cat = getStatusCategory(t.status);
      counts[cat] = (counts[cat] || 0) + 1;
    }

    const total = tasks.length || 1;
    return [
      { key: 'OPEN', label: 'Open', count: counts.OPEN, pct: Math.round((counts.OPEN / total) * 100), color: 'bg-blue-500' },
      { key: 'IN_PROGRESS', label: 'In Progress', count: counts.IN_PROGRESS, pct: Math.round((counts.IN_PROGRESS / total) * 100), color: 'bg-amber-500' },
      { key: 'PENDING_USER', label: 'Pending User', count: counts.PENDING_USER, pct: Math.round((counts.PENDING_USER / total) * 100), color: 'bg-purple-500' },
      { key: 'RESOLVED', label: 'Resolved', count: counts.RESOLVED, pct: Math.round((counts.RESOLVED / total) * 100), color: 'bg-emerald-500' },
      { key: 'CLOSED', label: 'Closed', count: counts.CLOSED, pct: Math.round((counts.CLOSED / total) * 100), color: 'bg-zinc-500' },
    ];
  }, [tasks]);

  // Department / Queue Workload Breakdown
  const spaceWorkload = useMemo(() => {
    const spaceMap = new Map<string, { name: string; key: string; total: number; active: number; breached: number }>();

    for (const t of tasks) {
      const spaceKey = t.space?.key || 'OTHER';
      const spaceName = t.space?.name || 'Unassigned Space';

      if (!spaceMap.has(spaceKey)) {
        spaceMap.set(spaceKey, { name: spaceName, key: spaceKey, total: 0, active: 0, breached: 0 });
      }

      const item = spaceMap.get(spaceKey)!;
      item.total++;

      const isDone = t.status?.isCompleted || t.status?.isClosed || getStatusCategory(t.status) === 'RESOLVED' || getStatusCategory(t.status) === 'CLOSED';
      if (!isDone) item.active++;

      const sla = computeSla(t);
      if (sla?.isBreached) item.breached++;
    }

    return Array.from(spaceMap.values()).sort((a, b) => b.total - a.total).slice(0, 5);
  }, [tasks]);

  // Priority Breakdown
  const priorityBreakdown = useMemo(() => {
    const counts = { URGENT: 0, HIGH: 0, NORMAL: 0, LOW: 0 };
    for (const t of tasks) {
      if (t.priority in counts) {
        counts[t.priority as keyof typeof counts]++;
      }
    }
    const total = tasks.length || 1;
    return [
      { key: 'URGENT', label: 'Urgent', count: counts.URGENT, pct: Math.round((counts.URGENT / total) * 100), color: 'text-rose-500 bg-rose-500/10 border-rose-500/30' },
      { key: 'HIGH', label: 'High', count: counts.HIGH, pct: Math.round((counts.HIGH / total) * 100), color: 'text-amber-500 bg-amber-500/10 border-amber-500/30' },
      { key: 'NORMAL', label: 'Normal', count: counts.NORMAL, pct: Math.round((counts.NORMAL / total) * 100), color: 'text-blue-500 bg-blue-500/10 border-blue-500/30' },
      { key: 'LOW', label: 'Low', count: counts.LOW, pct: Math.round((counts.LOW / total) * 100), color: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/30' },
    ];
  }, [tasks]);

  // Panel A: SLA Breached & Watchlist
  const breachedTickets = useMemo(() => {
    return tasks
      .filter((t) => {
        const isDone = t.status?.isCompleted || t.status?.isClosed;
        if (isDone) return false;
        const sla = computeSla(t);
        return sla?.isBreached || sla?.isWatch || t.priority === 'URGENT';
      })
      .sort((a, b) => {
        const slaA = computeSla(a);
        const slaB = computeSla(b);
        return (slaB?.elapsedHours || 0) - (slaA?.elapsedHours || 0);
      })
      .slice(0, 6);
  }, [tasks]);

  // Panel B: Upcoming Milestones & Blocked Dependencies
  const milestonesAndBlocked = useMemo(() => {
    const list: Array<{
      task: TaskRecord;
      type: 'milestone' | 'blocked';
      detail: string;
    }> = [];

    const taskMap = new Map<string, TaskRecord>();
    for (const t of tasks) taskMap.set(t.id, t);

    for (const t of tasks) {
      if (t.isMilestone) {
        const isDone = t.status?.isCompleted || t.status?.isClosed;
        list.push({
          task: t,
          type: 'milestone',
          detail: isDone ? 'Completed' : `Target: ${t.dueDate ? new Date(t.dueDate).toLocaleDateString() : 'Active'}`,
        });
      }

      if (t.dependsOnIds) {
        try {
          const parsed = JSON.parse(t.dependsOnIds);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const blockers = parsed
              .map((id) => taskMap.get(id))
              .filter(Boolean)
              .filter((p) => !p?.status?.isCompleted && !p?.status?.isClosed) as TaskRecord[];

            if (blockers.length > 0) {
              list.push({
                task: t,
                type: 'blocked',
                detail: `Blocked by ${blockers.map((b) => b.taskKey).join(', ')}`,
              });
            }
          }
        } catch {}
      }
    }

    return list.slice(0, 6);
  }, [tasks]);

  // Panel C: Team Assignee Workload & Capacity
  const assigneeCapacity = useMemo(() => {
    const map = new Map<string, { name: string; username: string; activeCount: number; completedCount: number }>();

    for (const t of tasks) {
      if (!t.assignee) continue;
      const uid = t.assignee.id;
      if (!map.has(uid)) {
        map.set(uid, {
          name: t.assignee.name,
          username: t.assignee.username,
          activeCount: 0,
          completedCount: 0,
        });
      }
      const entry = map.get(uid)!;
      const isDone = t.status?.isCompleted || t.status?.isClosed;
      if (isDone) entry.completedCount++;
      else entry.activeCount++;
    }

    return Array.from(map.values())
      .sort((a, b) => b.activeCount - a.activeCount)
      .slice(0, 5);
  }, [tasks]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 pb-12 space-y-6 text-zinc-900 dark:text-zinc-100 select-none">
      {/* =========================================================================
          1. Contextual Executive KPI Cards (Top 5-Column Grid)
         ========================================================================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* KPI 1: Total Scoped Tickets */}
        <div className="p-4 rounded-xl bg-white dark:bg-zinc-900/90 border border-slate-200 dark:border-zinc-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Tickets</span>
            <Activity className="w-4 h-4 text-blue-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono">{kpis.total}</span>
            <span className="text-xs text-zinc-500">
              ({kpis.openCount} Open / {kpis.closedCount} Closed)
            </span>
          </div>
          <div className="mt-2 w-full bg-slate-100 dark:bg-zinc-800 h-1.5 rounded-full overflow-hidden flex">
            <div
              style={{ width: `${kpis.total > 0 ? (kpis.openCount / kpis.total) * 100 : 0}%` }}
              className="bg-blue-500 h-full"
            />
            <div
              style={{ width: `${kpis.total > 0 ? (kpis.closedCount / kpis.total) * 100 : 0}%` }}
              className="bg-emerald-500 h-full"
            />
          </div>
        </div>

        {/* KPI 2: Active In-Progress Load */}
        <div className="p-4 rounded-xl bg-white dark:bg-zinc-900/90 border border-slate-200 dark:border-zinc-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
            <span className="text-xs font-semibold uppercase tracking-wider">In-Progress Load</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400">
              {kpis.inProgressCount}
            </span>
            <span className="text-xs text-zinc-500">
              Avg age: {kpis.avgAgeHours}h
            </span>
          </div>
          <span className="mt-2 text-[11px] text-zinc-500 truncate">
            Active department work pipeline
          </span>
        </div>

        {/* KPI 3: SLA Health & Compliance */}
        <div className="p-4 rounded-xl bg-white dark:bg-zinc-900/90 border border-slate-200 dark:border-zinc-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
            <span className="text-xs font-semibold uppercase tracking-wider">SLA Compliance</span>
            <ShieldCheck className={cn('w-4 h-4', kpis.breachedCount > 0 ? 'text-rose-500' : 'text-emerald-500')} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={cn(
                'text-2xl font-bold font-mono',
                kpis.breachedCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
              )}
            >
              {kpis.slaCompliancePct}%
            </span>
            {kpis.breachedCount > 0 && (
              <span className="text-xs font-bold text-rose-500 flex items-center gap-0.5">
                <AlertTriangle className="w-3 h-3" />
                {kpis.breachedCount} Breached
              </span>
            )}
          </div>
          <span className="mt-2 text-[11px] text-zinc-500 truncate">
            {kpis.watchCount} tickets on SLA watch
          </span>
        </div>

        {/* KPI 4: Cross-Dept Collaborations */}
        <div className="p-4 rounded-xl bg-white dark:bg-zinc-900/90 border border-slate-200 dark:border-zinc-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Collaborations</span>
            <GitPullRequest className="w-4 h-4 text-purple-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-purple-600 dark:text-purple-400">
              {kpis.collaboratedCount}
            </span>
            <span className="text-xs text-zinc-500">Handoffs</span>
          </div>
          <span className="mt-2 text-[11px] text-zinc-500 truncate">
            Cross-department route active
          </span>
        </div>

        {/* KPI 5: Subtask & Milestone Velocity */}
        <div className="p-4 rounded-xl bg-white dark:bg-zinc-900/90 border border-slate-200 dark:border-zinc-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Subtask Velocity</span>
            <Sparkles className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
              {kpis.checklistPct}%
            </span>
            <span className="text-xs text-zinc-500">
              ({kpis.completedChecklists}/{kpis.totalChecklists})
            </span>
          </div>
          <span className="mt-2 text-[11px] text-amber-500 dark:text-amber-400 font-medium truncate flex items-center gap-1">
            <span>◆ {kpis.completedMilestones}/{kpis.totalMilestones} Milestones Met</span>
          </span>
        </div>
      </div>

      {/* =========================================================================
          2. Visual Analytics Grid (Pure CSS/SVG Charts — Zero External Libraries)
         ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Chart 1 — Workflow Status Distribution */}
        <div className="p-4 rounded-xl bg-white dark:bg-zinc-900/90 border border-slate-200 dark:border-zinc-800 shadow-sm flex flex-col">
          <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
            Workflow Status Distribution
          </h3>

          {/* Stacked Horizontal Progress Bar */}
          <div className="w-full h-3 rounded-md overflow-hidden flex bg-slate-100 dark:bg-zinc-800 mb-4">
            {statusDistribution.map((st) => (
              <div
                key={st.key}
                style={{ width: `${st.pct}%` }}
                className={cn(st.color, 'h-full transition-all')}
                title={`${st.label}: ${st.count} (${st.pct}%)`}
              />
            ))}
          </div>

          {/* Status Breakdown Rows */}
          <div className="space-y-2 mt-auto">
            {statusDistribution.map((st) => (
              <div key={st.key} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className={cn('w-2.5 h-2.5 rounded-full', st.color)} />
                  <span className="text-zinc-700 dark:text-zinc-300 font-medium">{st.label}</span>
                </div>
                <div className="flex items-center gap-2 font-mono">
                  <span className="text-zinc-900 dark:text-zinc-100 font-bold">{st.count}</span>
                  <span className="text-zinc-400 text-[11px] w-9 text-right">({st.pct}%)</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Chart 2 — Department & Queue Workload Breakdown */}
        <div className="p-4 rounded-xl bg-white dark:bg-zinc-900/90 border border-slate-200 dark:border-zinc-800 shadow-sm flex flex-col">
          <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
            Department Space Workload
          </h3>

          <div className="space-y-3 mt-1">
            {spaceWorkload.map((sw) => {
              const maxVol = spaceWorkload[0]?.total || 1;
              const fillPct = Math.round((sw.total / maxVol) * 100);

              return (
                <div key={sw.key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-zinc-800 dark:text-zinc-200 truncate flex items-center gap-1.5">
                      <span className="font-mono text-[11px] text-zinc-500">{sw.key}</span>
                      <span className="truncate">{sw.name}</span>
                    </span>
                    <span className="font-mono text-[11px] text-zinc-500">
                      <strong>{sw.total}</strong> tickets ({sw.active} active)
                    </span>
                  </div>

                  <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-zinc-800 overflow-hidden flex">
                    <div
                      style={{ width: `${fillPct}%` }}
                      className={cn(
                        'h-full rounded-full transition-all',
                        sw.breached > 0 ? 'bg-amber-500' : 'bg-blue-500'
                      )}
                    />
                  </div>
                </div>
              );
            })}

            {spaceWorkload.length === 0 && (
              <div className="py-8 text-center text-xs text-zinc-500">
                No space activity recorded.
              </div>
            )}
          </div>
        </div>

        {/* Chart 3 — Priority & Risk Matrix */}
        <div className="p-4 rounded-xl bg-white dark:bg-zinc-900/90 border border-slate-200 dark:border-zinc-800 shadow-sm flex flex-col">
          <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
            Priority & Risk Matrix
          </h3>

          <div className="grid grid-cols-2 gap-2.5 flex-1">
            {priorityBreakdown.map((pb) => (
              <button
                key={pb.key}
                type="button"
                onClick={() => onPriorityFilterClick?.(pb.key)}
                className={cn(
                  'p-3 rounded-lg border flex flex-col justify-between transition-all hover:scale-102 cursor-pointer text-left',
                  pb.color
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider">{pb.label}</span>
                  <Flag className="w-3.5 h-3.5" />
                </div>
                <div className="mt-3 flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold font-mono">{pb.count}</span>
                  <span className="text-[11px] font-medium opacity-80">({pb.pct}%)</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* =========================================================================
          3. Actionable Work Tables Alongside Metrics (Bottom Split Grid)
         ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Panel A: SLA Breached & High-Risk Watchlist */}
        <div className="p-4 rounded-xl bg-white dark:bg-zinc-900/90 border border-slate-200 dark:border-zinc-800 shadow-sm flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200/80 dark:border-zinc-800 mb-2">
            <h4 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
              <span>SLA Breached & High Risk</span>
            </h4>
            <span className="text-[10px] font-mono text-zinc-500">
              {breachedTickets.length} items
            </span>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-zinc-800/60 flex-1">
            {breachedTickets.map((t) => {
              const sla = computeSla(t);
              return (
                <div
                  key={t.id}
                  onClick={() => onTaskClick?.(t)}
                  className="py-2.5 flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-zinc-800/40 p-1.5 rounded cursor-pointer transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] font-bold text-zinc-800 dark:text-zinc-200">
                        {t.taskKey}
                      </span>
                      <span
                        className={cn(
                          'text-[9px] font-mono px-1 py-0.2 rounded uppercase font-bold',
                          t.priority === 'URGENT'
                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400'
                        )}
                      >
                        {t.priority}
                      </span>
                    </div>
                    <p className="text-xs truncate text-zinc-700 dark:text-zinc-300 font-medium mt-0.5">
                      {t.title}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    {sla?.isBreached ? (
                      <span className="text-[10px] font-mono font-bold text-rose-500">
                        +{Math.floor(sla.elapsedHours)}h breach
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono text-amber-500">
                        {Math.round(sla?.percentElapsed || 0)}% SLA
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {breachedTickets.length === 0 && (
              <div className="py-8 text-center text-xs text-emerald-500 flex flex-col items-center gap-1">
                <CheckCircle2 className="w-5 h-5" />
                <span>Zero breached tickets! SLA 100% on track.</span>
              </div>
            )}
          </div>
        </div>

        {/* Panel B: Upcoming Milestones & Blocked Dependencies */}
        <div className="p-4 rounded-xl bg-white dark:bg-zinc-900/90 border border-slate-200 dark:border-zinc-800 shadow-sm flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200/80 dark:border-zinc-800 mb-2">
            <h4 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Milestones & Blockers</span>
            </h4>
            <span className="text-[10px] font-mono text-zinc-500">
              {milestonesAndBlocked.length} items
            </span>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-zinc-800/60 flex-1">
            {milestonesAndBlocked.map((item, idx) => (
              <div
                key={`${item.task.id}-${idx}`}
                onClick={() => onTaskClick?.(item.task)}
                className="py-2.5 flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-zinc-800/40 p-1.5 rounded cursor-pointer transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {item.type === 'milestone' ? (
                      <span className="text-amber-400 font-bold text-xs">◆</span>
                    ) : (
                      <LinkIcon className="w-3 h-3 text-rose-500 shrink-0" />
                    )}
                    <span className="font-mono text-[11px] font-bold text-zinc-800 dark:text-zinc-200">
                      {item.task.taskKey}
                    </span>
                    <span className="text-[10px] text-zinc-500 font-mono">
                      {item.task.space?.key}
                    </span>
                  </div>
                  <p className="text-xs truncate text-zinc-700 dark:text-zinc-300 font-medium mt-0.5">
                    {item.task.title}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <span
                    className={cn(
                      'text-[10px] font-mono px-1.5 py-0.5 rounded border',
                      item.type === 'milestone'
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                        : 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 border-rose-300 dark:border-rose-800'
                    )}
                  >
                    {item.detail}
                  </span>
                </div>
              </div>
            ))}

            {milestonesAndBlocked.length === 0 && (
              <div className="py-8 text-center text-xs text-zinc-500">
                No active milestones or blocked dependencies.
              </div>
            )}
          </div>
        </div>

        {/* Panel C: Team Assignee Workload & Capacity */}
        <div className="p-4 rounded-xl bg-white dark:bg-zinc-900/90 border border-slate-200 dark:border-zinc-800 shadow-sm flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200/80 dark:border-zinc-800 mb-2">
            <h4 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-blue-400" />
              <span>Team Assignee Capacity</span>
            </h4>
            <span className="text-[10px] font-mono text-zinc-500">
              {assigneeCapacity.length} staff
            </span>
          </div>

          <div className="space-y-3 flex-1 pt-1">
            {assigneeCapacity.map((ac) => {
              const maxActive = assigneeCapacity[0]?.activeCount || 1;
              const loadPct = Math.round((ac.activeCount / maxActive) * 100);

              return (
                <div key={ac.username} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-slate-200 dark:bg-zinc-800 text-[10px] font-bold text-zinc-700 dark:text-zinc-300 flex items-center justify-center">
                        {ac.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium text-zinc-800 dark:text-zinc-200 truncate">
                        {ac.name}
                      </span>
                    </div>

                    <div className="font-mono text-[11px] text-zinc-500">
                      <strong>{ac.activeCount}</strong> active / {ac.completedCount} done
                    </div>
                  </div>

                  <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-zinc-800 overflow-hidden flex">
                    <div
                      style={{ width: `${loadPct}%` }}
                      className={cn(
                        'h-full rounded-full transition-all',
                        ac.activeCount > 3 ? 'bg-amber-500' : 'bg-blue-500'
                      )}
                    />
                  </div>
                </div>
              );
            })}

            {assigneeCapacity.length === 0 && (
              <div className="py-8 text-center text-xs text-zinc-500">
                No tickets currently assigned to staff.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
