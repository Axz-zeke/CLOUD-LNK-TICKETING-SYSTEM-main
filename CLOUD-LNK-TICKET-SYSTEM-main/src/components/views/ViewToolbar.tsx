'use client';

import React from 'react';
import {
  Search,
  Filter,
  X,
  RefreshCw,
  AlertCircle,
  Clock,
  User,
  CheckCircle,
  LayoutGrid,
} from 'lucide-react';
import { TaskStatusItem } from '@/context/workspace-context';
import { DateRangeFilter } from './DateRangeFilter';

export interface ViewToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  priorityFilter: string;
  onPriorityChange: (value: string) => void;
  statusFilter: string;
  onStatusChange: (value: string) => void;
  assigneeFilter: string;
  onAssigneeChange: (value: string) => void;
  dateFrom?: string;
  dateTo?: string;
  onDateRangeChange?: (from: string, to: string) => void;
  availableStatuses: TaskStatusItem[];
  onClearFilters: () => void;
  onRefresh: () => void;
  isLoading: boolean;
  totalTasksCount: number;
  activeView?: 'list' | 'board' | 'gantt' | 'dashboard';
  boardColumns?: number;
  columnCount?: number;
  onBoardColumnsChange?: (cols: number) => void;
  onColumnCountChange?: (cols: number) => void;
  ganttScale?: 'day' | 'week' | 'month';
  onGanttScaleChange?: (scale: 'day' | 'week' | 'month') => void;
  onGanttTodayClick?: () => void;
  ganttMilestonesOnly?: boolean;
  onGanttMilestonesOnlyChange?: (val: boolean) => void;
}

export function ViewToolbar({
  search,
  onSearchChange,
  priorityFilter,
  onPriorityChange,
  statusFilter,
  onStatusChange,
  assigneeFilter,
  onAssigneeChange,
  dateFrom,
  dateTo,
  onDateRangeChange,
  availableStatuses,
  onClearFilters,
  onRefresh,
  isLoading,
  totalTasksCount,
  activeView,
  boardColumns = 5,
  columnCount,
  onBoardColumnsChange,
  onColumnCountChange,
  ganttScale = 'day',
  onGanttScaleChange,
  onGanttTodayClick,
  ganttMilestonesOnly = false,
  onGanttMilestonesOnlyChange,
}: ViewToolbarProps) {
  const totalStatuses = availableStatuses && availableStatuses.length > 0 ? availableStatuses.length : 5;
  const maxAllowedCols = Math.max(3, Math.min(totalStatuses, 6));
  const columnOptions: number[] = [];
  for (let i = 3; i <= maxAllowedCols; i++) {
    columnOptions.push(i);
  }
  const activeCount = columnCount ?? boardColumns ?? maxAllowedCols;
  const currentColumns = columnOptions.includes(activeCount)
    ? activeCount
    : Math.max(3, Math.min(activeCount, maxAllowedCols));
  const handleColumnsChange = onColumnCountChange || onBoardColumnsChange;
  const hasActiveFilters = Boolean(
    search || priorityFilter || statusFilter || assigneeFilter || dateFrom || dateTo
  );

  return (
    <div
      data-tour="search-filter-bar"
      className="flex-shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-[#EAF0F8] border border-[#C8D5E6] dark:bg-zinc-950 dark:border-zinc-800/80 rounded-xl shadow-xs text-xs relative z-30"
    >
      {/* 1. Left: Search Input */}
      <div className="relative flex-1 max-w-sm">
        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#475569] dark:text-zinc-500" />
        <input
          type="text"
          placeholder="Search by title, ticket key (e.g. MIS-101)..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-8 pr-7 py-1.5 bg-[#F3F6FB] hover:bg-[#F7F9FD] border border-[#C4D2E4] rounded-lg text-[#0F172A] placeholder:text-[#475569] focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* 2. Middle & Right: Filter Selectors & Board Density */}
      <div className="flex flex-wrap items-center gap-2 max-w-full">
        {/* Status Dropdown */}
        <select
          value={statusFilter}
          onChange={(e) => onStatusChange(e.target.value)}
          className="px-2.5 py-1.5 bg-[#F3F6FB] hover:bg-[#F7F9FD] border border-[#C4D2E4] rounded-lg text-[#0F172A] focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-300"
        >
          <option value="">All Statuses</option>
          {availableStatuses.map((st) => (
            <option key={st.id} value={st.id}>
              {st.name}
            </option>
          ))}
        </select>

        {/* Priority Dropdown */}
        <select
          value={priorityFilter}
          onChange={(e) => onPriorityChange(e.target.value)}
          className="px-2.5 py-1.5 bg-[#F3F6FB] hover:bg-[#F7F9FD] border border-[#C4D2E4] rounded-lg text-[#0F172A] focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-300"
        >
          <option value="">All Priorities</option>
          <option value="URGENT">Urgent</option>
          <option value="HIGH">High</option>
          <option value="NORMAL">Normal</option>
          <option value="LOW">Low</option>
        </select>

        {/* Assignee Filter */}
        <select
          value={assigneeFilter}
          onChange={(e) => onAssigneeChange(e.target.value)}
          className="px-2.5 py-1.5 bg-[#F3F6FB] hover:bg-[#F7F9FD] border border-[#C4D2E4] rounded-lg text-[#0F172A] focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-300"
        >
          <option value="">All Assignees</option>
          <option value="me">Assigned to Me</option>
          <option value="unassigned">Unassigned</option>
        </select>

        {/* Date Range Filter */}
        <DateRangeFilter
          dateFrom={dateFrom || ''}
          dateTo={dateTo || ''}
          onDateRangeChange={onDateRangeChange || (() => {})}
        />

        {/* Clear Filters Button */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={onClearFilters}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-[#D8E1EE] hover:bg-[#CAD8EA] text-[#0F172A] border border-[#C4D1E2] rounded-lg transition-colors cursor-pointer dark:bg-zinc-900 dark:hover:bg-zinc-800 dark:text-zinc-400 dark:hover:text-white dark:border-zinc-800"
          >
            <X className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
        )}

        {/* Reload / Refresh Button */}
        <button
          type="button"
          onClick={onRefresh}
          title="Reload tickets"
          className="p-1.5 bg-[#D8E1EE] hover:bg-[#CAD8EA] border border-[#C4D1E2] rounded-lg text-[#0F172A] transition-colors cursor-pointer dark:bg-zinc-900 dark:hover:bg-zinc-800 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>

        {/* Board Column Density Selector (Visible when Board View is active) */}
        {activeView === 'board' && handleColumnsChange && (
          <div className="hidden md:flex items-center gap-1.5 pl-2 border-l border-[#C8D5E6] dark:border-zinc-800">
            <div className="flex items-center gap-1 text-[#475569] dark:text-zinc-400" title="Columns density">
              <LayoutGrid className="w-3.5 h-3.5 text-[#475569] dark:text-zinc-400" />
              <span className="text-[11px] font-medium">Columns:</span>
            </div>
            <div className="inline-flex items-center bg-[#D8E1EE] border border-[#C4D1E2] dark:bg-zinc-900 dark:border-zinc-800 rounded-lg p-0.5 shadow-inner">
              {columnOptions.map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => handleColumnsChange(num)}
                  title={`Show ${num} columns per view`}
                  className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors cursor-pointer ${
                    currentColumns === num
                      ? 'bg-[#F0F4FA] text-[#1D4ED8] shadow-xs ring-1 ring-[#ADC8EC] dark:bg-white/10 dark:text-white font-semibold'
                      : 'text-[#334155] hover:text-[#0F172A] hover:bg-[#CAD8EA]/60 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-800/60 font-medium'
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Gantt Timeline Scale & Controls Selector (Visible when Gantt View is active) */}
        {activeView === 'gantt' && (
          <div className="hidden md:flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-zinc-800">
            {/* Scale Selector */}
            <div className="inline-flex items-center bg-slate-100 border border-slate-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-lg p-0.5 shadow-inner">
              {(['day', 'week', 'month'] as const).map((sc) => (
                <button
                  key={sc}
                  type="button"
                  onClick={() => onGanttScaleChange?.(sc)}
                  title={`View timeline by ${sc}`}
                  className={`px-2 py-0.5 text-[11px] capitalize rounded transition-colors cursor-pointer ${
                    (ganttScale || 'day') === sc
                      ? 'bg-white text-blue-600 shadow-sm ring-1 ring-blue-100 dark:bg-white/10 dark:text-white font-semibold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-800/60 font-medium'
                  }`}
                >
                  {sc}
                </button>
              ))}
            </div>

            {/* Jump to Today Button */}
            {onGanttTodayClick && (
              <button
                type="button"
                onClick={onGanttTodayClick}
                title="Scroll timeline to current date"
                className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800 dark:text-zinc-300 border border-slate-200 dark:border-zinc-800 rounded-lg transition-colors cursor-pointer"
              >
                <Clock className="w-3 h-3 text-blue-500" />
                <span>Today</span>
              </button>
            )}

            {/* Milestones Filter Toggle */}
            {onGanttMilestonesOnlyChange && (
              <button
                type="button"
                onClick={() => onGanttMilestonesOnlyChange(!ganttMilestonesOnly)}
                title="Filter to project milestones only"
                className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium border rounded-lg transition-colors cursor-pointer ${
                  ganttMilestonesOnly
                    ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700 font-semibold'
                    : 'bg-slate-100 hover:bg-slate-200 text-zinc-600 dark:bg-zinc-900 dark:hover:bg-zinc-800 dark:text-zinc-400 border-slate-200 dark:border-zinc-800'
                }`}
              >
                <span className="text-amber-500 font-bold">◆</span>
                <span>Milestones</span>
              </button>
            )}
          </div>
        )}

        {/* Counter Badge */}
        <span className="text-[11px] font-mono text-zinc-500 pl-1">
          {totalTasksCount} {totalTasksCount === 1 ? 'task' : 'tasks'}
        </span>
      </div>
    </div>
  );
}
