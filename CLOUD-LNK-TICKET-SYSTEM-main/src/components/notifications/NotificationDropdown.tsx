'use client';

import React, { useState } from 'react';
import {
  Bell,
  CheckCheck,
  Clock,
  ExternalLink,
  Volume2,
  VolumeX,
  Trash2,
  BellRing,
} from 'lucide-react';
import { NotificationItem } from '@/context/workspace-context';

export interface NotificationDropdownProps {
  isOpen: boolean;
  onClose?: () => void;
  notifications: NotificationItem[];
  unreadCount: number;
  isSoundMuted?: boolean;
  toggleSound?: () => void;
  hasDesktopPermission?: boolean;
  requestDesktopPermission?: () => Promise<void>;
  markNotificationRead?: (id: string) => Promise<void>;
  markAllNotificationsRead?: () => Promise<void>;
  clearReadNotifications?: () => Promise<void>;
  onNotificationClick?: (notif: NotificationItem) => void;
}

function formatRelativeTime(dateString: string): string {
  try {
    const now = Date.now();
    const then = new Date(dateString).getTime();
    const diffSec = Math.max(0, Math.floor((now - then) / 1000));

    if (diffSec < 45) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(dateString).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

export function NotificationDropdown({
  isOpen,
  onClose,
  notifications,
  unreadCount,
  isSoundMuted = false,
  toggleSound,
  hasDesktopPermission = true,
  requestDesktopPermission,
  markNotificationRead,
  markAllNotificationsRead,
  clearReadNotifications,
  onNotificationClick,
}: NotificationDropdownProps) {
  const [isClearing, setIsClearing] = useState(false);

  if (!isOpen) return null;

  const safeNotifications = Array.isArray(notifications) ? notifications : [];
  const hasReadNotifications = safeNotifications.some((n) => n?.isRead);

  const handleClearRead = async () => {
    if (!clearReadNotifications || isClearing) return;
    try {
      setIsClearing(true);
      await clearReadNotifications();
    } finally {
      setIsClearing(false);
    }
  };

  const handleMarkAllRead = async () => {
    if (!markAllNotificationsRead) return;
    await markAllNotificationsRead();
  };

  const handleItemClick = async (notif: NotificationItem) => {
    if (!notif.isRead && markNotificationRead) {
      await markNotificationRead(notif.id);
    }
    onNotificationClick?.(notif);
  };

  return (
    <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 shadow-2xl flex flex-col overflow-hidden z-[60] text-zinc-900 dark:text-zinc-100 animate-in fade-in slide-in-from-top-1 duration-150">
      {/* 1. Anchored Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/90 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-blue-500 dark:text-blue-400" />
          <span className="text-xs font-semibold">Notifications</span>
          {unreadCount > 0 ? (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-blue-100 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 font-semibold">
              {unreadCount} unread
            </span>
          ) : (
            <span className="text-[10px] text-zinc-500 font-normal">
              All caught up
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Sound mute toggle */}
          {toggleSound && (
            <button
              type="button"
              onClick={toggleSound}
              className={`p-1 rounded transition-colors cursor-pointer ${
                isSoundMuted
                  ? 'text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
              title={isSoundMuted ? 'Sound muted (click to unmute)' : 'Sound enabled (click to mute)'}
            >
              {isSoundMuted ? (
                <VolumeX className="w-3.5 h-3.5" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          {/* Native OS permission prompt if not enabled */}
          {!hasDesktopPermission && requestDesktopPermission && typeof window !== 'undefined' && 'Notification' in window && (
            <button
              type="button"
              onClick={requestDesktopPermission}
              className="text-[10px] text-amber-600 dark:text-amber-400 hover:underline transition-colors flex items-center gap-1 cursor-pointer"
              title="Enable native desktop alerts"
            >
              <BellRing className="w-3 h-3" />
              <span className="hidden sm:inline">OS Alerts</span>
            </button>
          )}

          {/* Mark All Read */}
          {unreadCount > 0 && markAllNotificationsRead && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="text-[10px] text-zinc-500 hover:text-blue-600 dark:text-zinc-400 dark:hover:text-blue-400 transition-colors flex items-center gap-1 cursor-pointer ml-1"
            >
              <CheckCheck className="w-3 h-3" />
              <span>Mark all read</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Scrollable Notifications List Container */}
      <div className="flex-1 min-h-0 max-h-[380px] sm:max-h-[440px] overflow-y-auto divide-y divide-slate-100 dark:divide-zinc-800/60 scrollbar-thin scrollbar-thumb-zinc-700/60 scrollbar-track-transparent custom-scrollbar">
        {safeNotifications.length === 0 ? (
          <div className="py-10 text-center text-xs text-zinc-500 italic">
            No notifications yet.
          </div>
        ) : (
          safeNotifications.map((notif) => (
            <div
              key={notif.id}
              onClick={() => handleItemClick(notif)}
              className={`p-3 text-xs transition-colors cursor-pointer flex gap-2.5 ${
                notif.isRead
                  ? 'bg-white hover:bg-slate-50 text-zinc-600 dark:bg-zinc-900/40 dark:hover:bg-zinc-800/60 dark:text-zinc-400 opacity-75'
                  : 'bg-blue-50/50 hover:bg-blue-50 text-zinc-900 dark:bg-zinc-800/50 dark:hover:bg-zinc-800/80 dark:text-zinc-100 border-l-2 border-l-blue-500'
              }`}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-xs truncate">
                    {notif.title}
                  </p>
                  <div className="flex items-center gap-1 text-[10px] font-mono text-zinc-400 dark:text-zinc-500 shrink-0">
                    <Clock className="w-2.5 h-2.5" />
                    <span>{formatRelativeTime(notif.createdAt)}</span>
                  </div>
                </div>
                <p className="text-[11px] text-zinc-600 dark:text-zinc-400 line-clamp-2 leading-relaxed">
                  {notif.message}
                </p>
                {notif.task && (
                  <div className="pt-1 flex items-center gap-1 text-[10px] font-mono text-blue-600 dark:text-blue-400">
                    <span>Ticket {notif.task.taskKey}</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 3. Anchored Footer */}
      {(hasReadNotifications || safeNotifications.length > 0) && (
        <div className="flex-shrink-0 px-4 py-2.5 border-t border-slate-200 dark:border-zinc-800 bg-slate-50/90 dark:bg-zinc-950/60 text-center flex items-center justify-between text-xs text-zinc-500">
          <span className="text-[11px] font-mono text-zinc-400 dark:text-zinc-500">
            {safeNotifications.length} notification{safeNotifications.length === 1 ? '' : 's'}
          </span>

          {hasReadNotifications && clearReadNotifications && (
            <button
              type="button"
              disabled={isClearing}
              onClick={handleClearRead}
              className="text-[10px] text-zinc-400 hover:text-red-600 dark:text-zinc-500 dark:hover:text-red-400 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
              title="Delete all read notifications"
            >
              <Trash2 className="w-3 h-3" />
              <span>{isClearing ? 'Clearing...' : 'Clear read'}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
