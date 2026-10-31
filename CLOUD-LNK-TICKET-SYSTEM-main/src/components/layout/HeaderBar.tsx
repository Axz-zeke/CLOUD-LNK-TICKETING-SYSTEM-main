'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  LayoutList,
  Kanban,
  Plus,
  Sparkles,
  Ticket,
  UserCheck,
  ListTodo,
  Bell,
  Sun,
  Moon,
  GitPullRequest,
  Search,
  CalendarRange,
  LayoutDashboard,
} from 'lucide-react';
import { useWorkspace, NotificationItem } from '@/context/workspace-context';
import { AuthenticatedUser } from '@/lib/security/rbac';
import { DepartmentReportModal } from '@/components/modals/DepartmentReportModal';
import { useTheme } from '@/components/providers/ThemeProvider';
import { hasTicketSpaceClearance } from '@/lib/security/permissions';
import { NotificationDropdown } from '@/components/notifications/NotificationDropdown';

interface HeaderBarProps {
  currentUser?: AuthenticatedUser;
}

export function HeaderBar({ currentUser }: HeaderBarProps) {
  const {
    workspace,
    spaces,
    activeScope,
    activeView,
    currentSpace,
    currentList,
    currentTitle,
    setActiveView,
    setCreateTicketModalOpen,
    setSelectedTaskId,
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
    setIsSearchModalOpen,
    refreshSpaces,
  } = useWorkspace();

  const { theme, resolvedTheme, toggleTheme } = useTheme();

  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const notificationsRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        notificationsRef.current &&
        !notificationsRef.current.contains(event.target as Node)
      ) {
        setIsNotificationsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Mark single notification as read & open ticket drawer
  const handleNotificationClick = async (notif: NotificationItem) => {
    if (!notif.isRead) {
      await markNotificationRead(notif.id);
    }

    if (notif.taskId) {
      setSelectedTaskId(notif.taskId);
      setIsNotificationsOpen(false);
    }
  };

  const safeNotifications = Array.isArray(notifications) ? notifications : [];

  const isSuperadmin = currentUser?.globalRole === 'SUPERADMIN';
  const canGenerateReport =
    isSuperadmin ||
    Boolean(currentSpace && hasTicketSpaceClearance(currentUser, currentSpace.id, spaces));

  return (
    <header className="relative z-50 overflow-visible w-full h-14 px-4 border-b border-[#C8D5E6] dark:border-white/10 bg-[#EAF0F8]/95 dark:bg-[#0F1219]/90 backdrop-blur-md flex items-center justify-between gap-2.5 select-none shrink-0 text-[#0F172A] dark:text-zinc-100">
      {/* 1. LEFT: Protected Breadcrumb & Title (Never shrinks or crushes) */}
      <div className="flex items-center gap-2.5 flex-shrink-0 min-w-max">
        {/* Context View Icon */}
        <div className="p-1.5 rounded-lg bg-[#D8E1EE] dark:bg-zinc-900 border border-[#C4D1E2] dark:border-zinc-800 text-[#334155] dark:text-zinc-400 flex items-center justify-center flex-shrink-0 shadow-2xs">
          {activeScope.type === 'fastView' &&
            (activeScope.fastViewId === 'everything' || activeScope.fastViewId === 'all') && (
            <Sparkles className="w-4 h-4 text-purple-400" />
          )}
          {activeScope.type === 'fastView' &&
            (activeScope.fastViewId === 'assigned_to_me' || activeScope.fastViewId === 'assigned') && (
            <UserCheck className="w-4 h-4 text-blue-400" />
          )}
          {activeScope.type === 'fastView' &&
            (activeScope.fastViewId === 'created_by_me' || activeScope.fastViewId === 'created') && (
            <Ticket className="w-4 h-4 text-emerald-400" />
          )}
          {activeScope.type === 'fastView' && activeScope.fastViewId === 'collaborated' && (
            <GitPullRequest className="w-4 h-4 text-amber-400" />
          )}
          {activeScope.type === 'space' && (
            <span className="text-xs font-mono font-bold text-zinc-700 dark:text-zinc-300">
              {currentSpace?.key?.substring(0, 3) || 'SPC'}
            </span>
          )}
          {activeScope.type === 'list' && (
            <ListTodo className="w-4 h-4 text-blue-400" />
          )}
        </div>

        {/* Title Text Stack */}
        <div className="flex flex-col leading-tight min-w-max">
          <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 whitespace-nowrap">
            {currentSpace ? currentSpace.name : 'Views'}
          </span>
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
            {currentList ? currentList.name : currentTitle}
          </span>
        </div>
      </div>

      {/* 2. RIGHT-SIDE CONTROLS CLUSTER */}
      <div className="flex items-center gap-2 flex-shrink-0 pr-1">
        {/* List / Board / Gantt / Dashboard Switcher */}
        <div
          data-tour="view-toggle"
          className="flex items-center gap-0.5 p-1 bg-[#D8E1EE] dark:bg-zinc-900/90 border border-[#C4D1E2] dark:border-zinc-800 rounded-lg flex-shrink-0"
        >
          <button
            type="button"
            onClick={() => setActiveView('list')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
              activeView === 'list'
                ? 'bg-[#F0F4FA] text-[#1D4ED8] shadow-xs ring-1 ring-[#ADC8EC] font-semibold dark:bg-white/10 dark:text-white'
                : 'text-[#334155] hover:text-[#0F172A] hover:bg-[#CAD8EA] dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
            title="List View"
          >
            <LayoutList className="w-3.5 h-3.5" />
            <span className="hidden md:inline">List</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveView('board')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
              activeView === 'board'
                ? 'bg-[#F0F4FA] text-[#1D4ED8] shadow-xs ring-1 ring-[#ADC8EC] font-semibold dark:bg-white/10 dark:text-white'
                : 'text-[#334155] hover:text-[#0F172A] hover:bg-[#CAD8EA] dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
            title="Board View (Kanban)"
          >
            <Kanban className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Board</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveView('gantt')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
              activeView === 'gantt'
                ? 'bg-[#F0F4FA] text-[#1D4ED8] shadow-xs ring-1 ring-[#ADC8EC] font-semibold dark:bg-white/10 dark:text-white'
                : 'text-[#334155] hover:text-[#0F172A] hover:bg-[#CAD8EA] dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
            title="Gantt Timeline View"
          >
            <CalendarRange className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Gantt</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveView('dashboard')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
              activeView === 'dashboard'
                ? 'bg-[#F0F4FA] text-[#1D4ED8] shadow-xs ring-1 ring-[#ADC8EC] font-semibold dark:bg-white/10 dark:text-white'
                : 'text-[#334155] hover:text-[#0F172A] hover:bg-[#CAD8EA] dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
            title="Contextual Dashboard View"
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Dashboard</span>
          </button>
        </div>

        {/* Global Search Input */}
        <div className="w-36 lg:w-44 xl:w-52 flex-shrink-0 relative">
          <button
            type="button"
            onClick={() => setIsSearchModalOpen(true)}
            className="relative flex items-center w-full bg-[#F3F6FB] hover:bg-[#F7F9FD] dark:bg-zinc-900/80 dark:hover:bg-zinc-800 border border-[#C4D2E4] dark:border-zinc-800 hover:border-[#ADC8EC] dark:hover:border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-[#334155] hover:text-[#0F172A] dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors cursor-pointer group"
            title="Search workspace (Ctrl+K or ⌘K)"
            aria-label="Search workspace"
          >
            <Search className="w-3.5 h-3.5 text-[#64748B] group-hover:text-[#0F172A] dark:group-hover:text-zinc-300 transition-colors shrink-0 mr-1.5" />
            <span className="truncate">Search workspace...</span>
            <kbd className="hidden sm:inline-flex text-[10px] font-mono bg-[#D8E1EE] text-[#475569] dark:bg-zinc-800 border border-[#C4D1E2] dark:border-zinc-700 px-1 rounded ml-auto flex-shrink-0">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Theme Toggle (Sun / Moon) */}
        <button
          type="button"
          data-tour="theme-toggle"
          onClick={toggleTheme}
          className="w-8 h-8 rounded-lg border border-[#C4D2E4] dark:border-zinc-800 bg-[#F3F6FB] dark:bg-zinc-900/60 hover:bg-[#F7F9FD] dark:hover:bg-zinc-800 text-[#334155] hover:text-[#0F172A] dark:text-zinc-400 dark:hover:text-zinc-200 flex items-center justify-center transition-colors cursor-pointer flex-shrink-0"
          title={resolvedTheme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          aria-label="Toggle workspace theme"
        >
          {resolvedTheme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400" />
          ) : (
            <Moon className="w-4 h-4 text-zinc-700" />
          )}
        </button>

        {/* Notifications Dropdown Trigger */}
        <div className="relative flex-shrink-0" ref={notificationsRef}>
          <button
            type="button"
            onClick={() => {
              setIsNotificationsOpen((prev) => {
                const next = !prev;
                if (next) {
                  fetchNotifications({ delta: false, forceFresh: true });
                }
                return next;
              });
            }}
            className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors relative cursor-pointer ${
              isNotificationsOpen
                ? 'bg-[#D6E4F7] dark:bg-zinc-800 border-[#ADC8EC] dark:border-zinc-600 text-[#1E3A8A] dark:text-zinc-100'
                : 'bg-[#F3F6FB] dark:bg-zinc-900/60 hover:bg-[#F7F9FD] dark:hover:bg-zinc-800 border-[#C4D2E4] dark:border-zinc-800 text-[#334155] hover:text-[#0F172A] dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
            aria-label="Notifications"
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-[#EAF0F8] dark:ring-zinc-950 pointer-events-none shadow-sm">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          <NotificationDropdown
            isOpen={isNotificationsOpen}
            onClose={() => setIsNotificationsOpen(false)}
            notifications={safeNotifications}
            unreadCount={unreadCount}
            isSoundMuted={isSoundMuted}
            toggleSound={toggleSound}
            hasDesktopPermission={hasDesktopPermission}
            requestDesktopPermission={requestDesktopPermission}
            markNotificationRead={markNotificationRead}
            markAllNotificationsRead={markAllNotificationsRead}
            clearReadNotifications={clearReadNotifications}
            onNotificationClick={handleNotificationClick}
          />
        </div>

        {/* Divider */}
        <div className="h-5 w-px bg-[#C8D5E6] dark:bg-zinc-800 mx-0.5 flex-shrink-0" />

        {/* Executive AI Report CTA */}
        {canGenerateReport && (
          <button
            type="button"
            data-tour="ai-report-btn"
            onClick={() => setIsReportModalOpen(true)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[#CBE0E0] hover:bg-[#BBD4D4] border border-[#A8CACA] text-[#0F5257] dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60 dark:hover:bg-emerald-900/50 flex items-center gap-1.5 transition-colors whitespace-nowrap flex-shrink-0 cursor-pointer"
            title={
              currentSpace
                ? `Generate AI Activity Report for ${currentSpace.name}`
                : 'Generate AI Activity Report'
            }
          >
            <Sparkles className="w-3.5 h-3.5 text-[#0F5257] dark:text-emerald-400 animate-pulse shrink-0" />
            <span>Generate AI Report</span>
          </button>
        )}

        {/* Primary Add Ticket CTA */}
        <button
          type="button"
          data-tour="add-ticket-btn"
          onClick={() => setCreateTicketModalOpen(true)}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-sm shadow-blue-600/20 flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap cursor-pointer transition-colors"
        >
          <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>Add Ticket</span>
        </button>
      </div>

      {/* Department AI Activity Report Modal */}
      {isReportModalOpen && (
        <DepartmentReportModal
          isOpen={isReportModalOpen}
          onClose={() => setIsReportModalOpen(false)}
          spaceId={currentSpace?.id}
          spaceName={currentSpace?.name}
          spaceKey={currentSpace?.key}
          currentUser={currentUser}
          availableSpaces={spaces}
        />
      )}
    </header>
  );
}
