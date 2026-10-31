'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Settings,
  Lock,
  User,
  Shield,
  LayoutGrid,
  Bell,
  Volume2,
  VolumeX,
  Check,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  Sparkles,
  Columns,
  Layers,
  Sun,
  Moon,
  Monitor,
  Compass,
  HelpCircle,
} from 'lucide-react';
import { AuthenticatedUser } from '@/lib/security/rbac';
import { useWorkspace } from '@/context/workspace-context';
import { useTheme, Theme } from '@/components/providers/ThemeProvider';
import { playNotificationChime } from '@/lib/audio';
import { SITE_CONFIG } from '@/lib/constants';

interface UserSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: AuthenticatedUser | null;
  onStartTour?: () => void;
}

export function UserSettingsModal({
  isOpen,
  onClose,
  currentUser,
  onStartTour,
}: UserSettingsModalProps) {
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<'account' | 'display' | 'notifications'>('account');

  const { userPreferences, updateUserPreferences } = useWorkspace();
  const { theme: activeTheme, setTheme } = useTheme();

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  // Preference save feedback state
  const [prefSaveFeedback, setPrefSaveFeedback] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Clear feedback when tab changes
  useEffect(() => {
    setPasswordError(null);
    setPasswordSuccess(null);
    setPrefSaveFeedback(null);
  }, [activeTab]);

  if (!isOpen) return null;
  if (!mounted || typeof document === 'undefined') return null;

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }

    setPasswordLoading(true);
    try {
      const res = await fetch('/api/user/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update password');
      }

      setPasswordSuccess('Password successfully updated! Your new credentials are active.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'An error occurred while changing password');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleUpdatePref = async (patch: Partial<typeof userPreferences>) => {
    await updateUserPreferences(patch);
    setPrefSaveFeedback('Preference saved');
    setTimeout(() => {
      setPrefSaveFeedback((prev) => (prev === 'Preference saved' ? null : prev));
    }, 2000);
  };

  const roleBadgeStyle =
    currentUser?.globalRole === 'SUPERADMIN'
      ? 'bg-red-950/80 text-red-300 border-red-800'
      : currentUser?.globalRole === 'ADMIN'
      ? 'bg-blue-950/80 text-blue-300 border-blue-800'
      : 'bg-zinc-800 text-zinc-300 border-zinc-700';

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 sm:p-6 animate-in fade-in duration-150"
    >
      <div
        className="relative flex flex-col w-full max-w-xl max-h-[90vh] bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 text-zinc-900 dark:text-zinc-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* MODAL HEADER */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-zinc-800 bg-slate-50/80 dark:bg-zinc-900/60 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-slate-100 dark:bg-zinc-800/80 border border-slate-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300">
              <Settings className="w-4 h-4 text-blue-500 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <span>Personal Account & Preferences</span>
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {SITE_CONFIG.shortCompany} • Security credentials, display settings, and notifications
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* NAVIGATION TABS */}
        <div className="flex items-center gap-1 px-6 pt-3 border-b border-slate-200 dark:border-zinc-800/80 bg-slate-100/50 dark:bg-zinc-900/30 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('account')}
            className={`px-3.5 py-2 rounded-t-lg text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer border-b-2 ${
              activeTab === 'account'
                ? 'border-blue-500 text-blue-600 dark:text-white bg-white dark:bg-zinc-900/60'
                : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <Lock className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
            <span>Account & Security</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('display')}
            className={`px-3.5 py-2 rounded-t-lg text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer border-b-2 ${
              activeTab === 'display'
                ? 'border-blue-500 text-blue-600 dark:text-white bg-white dark:bg-zinc-900/60'
                : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5 text-purple-500 dark:text-purple-400" />
            <span>Display & Workspace</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('notifications')}
            className={`px-3.5 py-2 rounded-t-lg text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer border-b-2 ${
              activeTab === 'notifications'
                ? 'border-blue-500 text-blue-600 dark:text-white bg-white dark:bg-zinc-900/60'
                : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <Bell className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
            <span>Notifications</span>
          </button>

          {prefSaveFeedback && (
            <div className="ml-auto flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium pb-1 animate-in fade-in">
              <Check className="w-3.5 h-3.5" />
              <span>{prefSaveFeedback}</span>
            </div>
          )}
        </div>

        {/* MODAL BODY */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* ========================================================================= */}
          {/* TAB 1: ACCOUNT & SECURITY */}
          {/* ========================================================================= */}
          {activeTab === 'account' && (
            <div className="space-y-6">
              {/* User Profile Summary Card */}
              <div className="p-4 rounded-xl bg-slate-100/70 dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-slate-200 dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 flex items-center justify-center text-base font-bold text-zinc-800 dark:text-zinc-200">
                    {(currentUser?.name?.charAt(0) || 'U').toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-900 dark:text-white">{currentUser?.name || 'Local User'}</span>
                      <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border ${roleBadgeStyle}`}>
                        {currentUser?.globalRole || 'EMPLOYEE'}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono mt-0.5">@{currentUser?.username || 'user'}</p>
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{currentUser?.email}</p>
                  </div>
                </div>
              </div>

              {/* Password Change Form */}
              <form onSubmit={handlePasswordSubmit} className="space-y-4">
                <div className="border-b border-slate-200 dark:border-zinc-800/80 pb-2">
                  <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
                    <span>Change Local Authentication Password</span>
                  </h3>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Update your local LAN account password. Must be at least 6 characters.
                  </p>
                </div>

                {passwordSuccess && (
                  <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2.5 animate-in fade-in">
                    <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>{passwordSuccess}</span>
                  </div>
                )}

                {passwordError && (
                  <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/70 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 text-xs flex items-center gap-2.5 animate-in fade-in">
                    <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                    <span>{passwordError}</span>
                  </div>
                )}

                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-700 dark:text-zinc-300 font-medium">Current Password</label>
                    <div className="relative">
                      <input
                        type={showCurrentPass ? 'text' : 'password'}
                        required
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="••••••••••••"
                        className="w-full pl-3 pr-10 py-2 bg-slate-50 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrentPass(!showCurrentPass)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                      >
                        {showCurrentPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-700 dark:text-zinc-300 font-medium">New Password</label>
                      <div className="relative">
                        <input
                          type={showNewPass ? 'text' : 'password'}
                          required
                          minLength={6}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Min. 6 characters"
                          className="w-full pl-3 pr-10 py-2 bg-slate-50 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPass(!showNewPass)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                        >
                          {showNewPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs text-zinc-700 dark:text-zinc-300 font-medium">Confirm New Password</label>
                      <input
                        type={showNewPass ? 'text' : 'password'}
                        required
                        minLength={6}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter new password"
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    disabled={passwordLoading}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-lg flex items-center gap-2 transition-colors cursor-pointer shadow-sm disabled:opacity-50"
                  >
                    {passwordLoading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Updating Password...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Update Password</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 2: DISPLAY & WORKSPACE */}
          {/* ========================================================================= */}
          {activeTab === 'display' && (
            <div className="space-y-6">
              {/* Theme Preference */}
              <div className="p-4 rounded-xl bg-slate-100/70 dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
                      <Sun className="w-3.5 h-3.5 text-amber-500" />
                      <span>Theme Preference</span>
                    </h3>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                      Choose between light mode, dark mode, or follow your workstation OS.
                    </p>
                  </div>
                  <span className="font-mono text-xs text-indigo-600 dark:text-indigo-400 font-bold bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800/80 px-2 py-0.5 rounded capitalize">
                    {activeTheme} Mode
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2.5 pt-1">
                  {[
                    { id: 'light', label: 'Light', icon: Sun, color: 'text-amber-500' },
                    { id: 'dark', label: 'Dark', icon: Moon, color: 'text-blue-500 dark:text-blue-400' },
                    { id: 'system', label: 'System', icon: Monitor, color: 'text-purple-500 dark:text-purple-400' },
                  ].map((t) => {
                    const isSelected = activeTheme === t.id;
                    const Icon = t.icon;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setTheme(t.id as Theme);
                          handleUpdatePref({ theme: t.id as Theme });
                        }}
                        className={`py-2.5 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer border ${
                          isSelected
                            ? 'bg-indigo-50 border-indigo-500 text-indigo-700 dark:bg-indigo-950/80 dark:border-indigo-500 dark:text-indigo-200 shadow-sm ring-1 ring-indigo-500/40'
                            : 'bg-white border-slate-200 text-zinc-600 hover:text-zinc-900 hover:border-slate-300 dark:bg-zinc-950 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:border-zinc-700'
                        }`}
                      >
                        <Icon className={`w-3.5 h-3.5 ${t.color}`} />
                        <span>{t.label}</span>
                        {isSelected && <Check className="w-3 h-3 text-indigo-600 dark:text-indigo-400 ml-0.5" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Board Column Density */}
              <div className="p-4 rounded-xl bg-slate-100/70 dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
                      <Columns className="w-3.5 h-3.5 text-purple-500 dark:text-purple-400" />
                      <span>Board Column Density</span>
                    </h3>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                      Configures the number of status columns shown side-by-side on Kanban Board view.
                    </p>
                  </div>
                  <span className="font-mono text-xs text-purple-600 dark:text-purple-400 font-bold bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800/80 px-2 py-0.5 rounded">
                    {userPreferences.boardDensity} Columns
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-2 pt-1">
                  {[3, 4, 5, 6].map((cols) => {
                    const isSelected = userPreferences.boardDensity === cols;
                    return (
                      <button
                        key={cols}
                        type="button"
                        onClick={() => handleUpdatePref({ boardDensity: cols })}
                        className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer border ${
                          isSelected
                            ? 'bg-purple-50 border-purple-500 text-purple-700 dark:bg-purple-950/80 dark:border-purple-700 dark:text-purple-200 shadow-sm'
                            : 'bg-white border-slate-200 text-zinc-600 hover:text-zinc-900 hover:border-slate-300 dark:bg-zinc-950 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:border-zinc-700'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 text-purple-600 dark:text-purple-400" />}
                        <span>{cols} Cols {cols === 4 ? '(Def)' : ''}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Compact Card Toggle */}
              <div className="p-4 rounded-xl bg-slate-100/70 dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800 flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
                    <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-200">Compact Ticket Cards</h3>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 max-w-sm">
                    Reduces vertical padding and tightens row spacing in both List and Board views to maximize ticket density.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleUpdatePref({ compactCards: !userPreferences.compactCards })}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 border ${
                    userPreferences.compactCards
                      ? 'bg-blue-600 border-blue-500'
                      : 'bg-slate-300 border-slate-300 dark:bg-zinc-800 dark:border-zinc-700'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-0.5 left-0.5 ${
                      userPreferences.compactCards ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Help & Guided Tours */}
              <div className="p-4 rounded-xl bg-slate-100/70 dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Compass className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
                    <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-200">
                      Help & Guided Tours
                    </h3>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Need a refresher on how the ticketing system works? Take a quick guided tour.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onStartTour?.();
                  }}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer shadow-xs shrink-0"
                >
                  <Compass className="w-3.5 h-3.5" />
                  <span>Take Workspace Tour</span>
                </button>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 3: NOTIFICATIONS & CHIMES */}
          {/* ========================================================================= */}
          {activeTab === 'notifications' && (
            <div className="space-y-4">
              {/* Sound Chimes */}
              <div className="p-4 rounded-xl bg-slate-100/70 dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800 flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Volume2 className="w-3.5 h-3.5 text-amber-500" />
                    <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-200">Audio Chimes</h3>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 max-w-sm">
                    Plays an unobtrusive synthesized Web Audio chime on incoming tickets and queue events.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => playNotificationChime()}
                    className="px-2.5 py-1 text-[11px] text-zinc-700 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white bg-white hover:bg-slate-50 dark:bg-zinc-800 dark:hover:bg-zinc-700 border border-slate-300 dark:border-zinc-700 rounded-md transition-colors cursor-pointer shadow-2xs"
                    title="Play test notification sound"
                  >
                    Test Chime
                  </button>

                  <button
                    type="button"
                    onClick={() => handleUpdatePref({ enableSound: !userPreferences.enableSound })}
                    className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 border ${
                      userPreferences.enableSound
                        ? 'bg-amber-600 border-amber-500'
                        : 'bg-slate-300 border-slate-300 dark:bg-zinc-800 dark:border-zinc-700'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-0.5 left-0.5 ${
                        userPreferences.enableSound ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Notify on Assignment */}
              <div className="p-4 rounded-xl bg-slate-100/70 dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800 flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Bell className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
                    <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-200">Ticket Assignments</h3>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 max-w-sm">
                    Receive immediate notifications and bell badge increments when a ticket is assigned to you.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleUpdatePref({ notifyOnAssign: !userPreferences.notifyOnAssign })}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 border ${
                    userPreferences.notifyOnAssign
                      ? 'bg-blue-600 border-blue-500'
                      : 'bg-slate-300 border-slate-300 dark:bg-zinc-800 dark:border-zinc-700'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-0.5 left-0.5 ${
                      userPreferences.notifyOnAssign ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Notify on Status Change */}
              <div className="p-4 rounded-xl bg-slate-100/70 dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-800 flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
                    <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-200">Status & Queue Updates</h3>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 max-w-sm">
                    Receive notifications when tickets you created or watch transition across statuses.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleUpdatePref({ notifyOnStatus: !userPreferences.notifyOnStatus })}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 border ${
                    userPreferences.notifyOnStatus
                      ? 'bg-emerald-600 border-emerald-500'
                      : 'bg-slate-300 border-slate-300 dark:bg-zinc-800 dark:border-zinc-700'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-0.5 left-0.5 ${
                      userPreferences.notifyOnStatus ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* MODAL FOOTER */}
        <div className="px-6 py-3.5 border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/60 flex items-center justify-between shrink-0">
          <span className="text-[11px] text-zinc-500 font-mono">
            {currentUser?.username ? `@${currentUser.username}` : 'Local Account'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium text-zinc-700 hover:text-zinc-900 bg-slate-100 hover:bg-slate-200 border border-slate-300 dark:text-zinc-300 dark:hover:text-white dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:border-zinc-700 rounded-lg transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
