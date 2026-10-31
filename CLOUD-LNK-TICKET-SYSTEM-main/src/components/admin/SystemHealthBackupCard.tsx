'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Database,
  HardDrive,
  Cpu,
  RefreshCw,
  Sparkles,
  Download,
  Clock,
  Files,
  Activity,
  Check,
  Server,
  Terminal,
  Trash2,
  Calendar,
  DatabaseBackup,
  AlertCircle,
  Plus,
  Cloud,
  CheckCircle2,
} from 'lucide-react';
import { toast } from '@/components/ui/toast';
import { BackupScheduleConfig, BackupScheduleItem, BackupFileInfo } from '@/lib/sqlite-maintenance';

export interface SystemHealthData {
  dbSizeMb: number;
  walSizeKb: number;
  uploadsSizeMb: number;
  pingMs: number;
  journalMode: string;
  uptimeSeconds: number;
  memoryMb: number;
  pageCount: number;
  pageSize: number;
  freelistCount: number;
  counts: {
    tasks: number;
    comments: number;
    users: number;
    attachments: number;
    totalRecords?: number;
  };
  vault?: {
    connected: boolean;
    storageUsedBytes: number;
    storageLimitBytes: number;
    storageUsedGb: number;
    storageLimitGb: number;
    percentUsed: number;
    status: string;
    attachmentsFolder: string;
    backupsFolder: string;
  };
  recentBackups: BackupFileInfo[];
  schedule: BackupScheduleConfig;
  dbPath?: string;
}

interface SystemHealthBackupCardProps {
  onRefreshParent?: () => void;
  showOnlyBadges?: boolean;
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function format12Hour(time24: string): string {
  if (!time24) return '12:00 AM';
  const [hhStr, mmStr] = time24.split(':');
  let hh = parseInt(hhStr || '0', 10);
  const mm = mmStr || '00';
  const ampm = hh >= 12 ? 'PM' : 'AM';
  hh = hh % 12;
  if (hh === 0) hh = 12;
  return `${hh}:${mm} ${ampm}`;
}

function formatScheduleTimePill(item: BackupScheduleItem): string {
  if (item.frequency === 'DAILY') {
    return format12Hour(item.timeOfDay);
  }
  if (item.frequency === 'WEEKLY') {
    const day = WEEKDAYS_SHORT[item.dayOfWeek ?? 0] || 'Sun';
    return `${day} • ${format12Hour(item.timeOfDay)}`;
  }
  if (item.frequency === 'HOURLY') return 'Hourly';
  if (item.frequency === 'EVERY_6_HOURS') return 'Every 6h';
  if (item.frequency === 'EVERY_12_HOURS') return 'Every 12h';
  return format12Hour(item.timeOfDay);
}

export function SystemHealthBackupCard({
  onRefreshParent,
  showOnlyBadges = false,
}: SystemHealthBackupCardProps) {
  const [data, setData] = useState<SystemHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [backupLoading, setBackupLoading] = useState(false);
  const [optimizeLoading, setOptimizeLoading] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [deletingFilename, setDeletingFilename] = useState<string | null>(null);
  const [togglingScheduleId, setTogglingScheduleId] = useState<string | null>(null);
  const [deletingScheduleId, setDeletingScheduleId] = useState<string | null>(null);

  // New Schedule Form State
  const [newLabel, setNewLabel] = useState('');
  const [newFrequency, setNewFrequency] = useState<BackupScheduleItem['frequency']>('DAILY');
  const [newTimeOfDay, setNewTimeOfDay] = useState('12:00');
  const [newDayOfWeek, setNewDayOfWeek] = useState(0);
  const [addingSchedule, setAddingSchedule] = useState(false);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/system-health');
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to fetch system health telemetry.');
      }
      const json: SystemHealthData = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err?.message || 'Network error fetching system telemetry');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  // 1. Create Hot Backup Action
  const handleCreateBackup = async () => {
    setBackupLoading(true);
    try {
      const res = await fetch('/api/admin/system-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'BACKUP' }),
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || 'Failed to create hot database snapshot.');
      }

      toast.success(
        `Saved snapshot: ${result.filename} (${result.fileSize})`,
        'Backup Created'
      );

      await fetchHealth();
      if (onRefreshParent) onRefreshParent();
    } catch (err: any) {
      toast.error(err?.message || 'Database snapshot operation failed', 'Backup Failed');
    } finally {
      setBackupLoading(false);
    }
  };

  // 2. Optimize & Flush WAL Action
  const handleOptimizeWal = async () => {
    setOptimizeLoading(true);
    try {
      const res = await fetch('/api/admin/system-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'OPTIMIZE_WAL' }),
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || 'Failed to optimize database engine.');
      }

      toast.success(
        result.message || 'Database connection and query planner verified.',
        'Engine Health Check'
      );

      await fetchHealth();
      if (onRefreshParent) onRefreshParent();
    } catch (err: any) {
      toast.error(err?.message || 'Optimization failed', 'Error');
    } finally {
      setOptimizeLoading(false);
    }
  };

  // 3. Update Global Settings (Master enable, Retention, Auto-WAL)
  const handleUpdateSettings = async (settings: {
    enabled?: boolean;
    retentionCount?: number;
    autoOptimizeWal?: boolean;
  }) => {
    setSettingsLoading(true);
    try {
      const res = await fetch('/api/admin/system-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'UPDATE_SCHEDULE_SETTINGS',
          settings,
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || 'Failed to update schedule settings.');
      }

      toast.success('Backup settings updated successfully.', 'Settings Saved');
      await fetchHealth();
      if (onRefreshParent) onRefreshParent();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update settings', 'Settings Error');
    } finally {
      setSettingsLoading(false);
    }
  };

  // 4. Add Custom Schedule Item
  const handleAddScheduleItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddingSchedule(true);
    try {
      const res = await fetch('/api/admin/system-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ADD_SCHEDULE',
          item: {
            label: newLabel.trim() || undefined,
            frequency: newFrequency,
            timeOfDay: newTimeOfDay,
            dayOfWeek: newFrequency === 'WEEKLY' ? newDayOfWeek : undefined,
          },
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || 'Failed to add backup schedule.');
      }

      toast.success('New backup schedule slot added and saved to Supabase SystemSetting.', 'Schedule Added');
      setNewLabel('');
      setNewTimeOfDay('12:00');
      await fetchHealth();
      if (onRefreshParent) onRefreshParent();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to add schedule', 'Creation Error');
    } finally {
      setAddingSchedule(false);
    }
  };

  // 5. Toggle Individual Schedule Slot
  const handleToggleScheduleItem = async (id: string, currentEnabled: boolean) => {
    setTogglingScheduleId(id);
    try {
      const res = await fetch('/api/admin/system-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'TOGGLE_SCHEDULE_ITEM',
          id,
          enabled: !currentEnabled,
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || 'Failed to toggle schedule item.');
      }

      toast.info(
        !currentEnabled ? 'Schedule slot activated.' : 'Schedule slot paused.',
        'Schedule Updated'
      );
      await fetchHealth();
      if (onRefreshParent) onRefreshParent();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to toggle schedule', 'Toggle Error');
    } finally {
      setTogglingScheduleId(null);
    }
  };

  // 6. Delete Individual Schedule Slot
  const handleDeleteScheduleItem = async (id: string, label: string) => {
    if (!window.confirm(`Delete backup schedule '${label}'?`)) {
      return;
    }

    setDeletingScheduleId(id);
    try {
      const res = await fetch('/api/admin/system-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'DELETE_SCHEDULE_ITEM',
          id,
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || 'Failed to delete schedule slot.');
      }

      toast.success(`Removed schedule: ${label}`, 'Schedule Deleted');
      await fetchHealth();
      if (onRefreshParent) onRefreshParent();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete schedule', 'Deletion Error');
    } finally {
      setDeletingScheduleId(null);
    }
  };

  // 7. Delete Backup Snapshot File
  const handleDeleteBackup = async (filename: string, fileId?: string) => {
    if (!window.confirm(`Permanently delete backup snapshot '${filename}'?`)) {
      return;
    }

    setDeletingFilename(filename);
    try {
      const res = await fetch('/api/admin/system-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'DELETE_BACKUP',
          filename,
          fileId,
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || 'Failed to delete backup file.');
      }

      toast.success(`Deleted snapshot: ${filename}`, 'Backup Removed');
      await fetchHealth();
      if (onRefreshParent) onRefreshParent();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete snapshot', 'Deletion Error');
    } finally {
      setDeletingFilename(null);
    }
  };

  // 8. Download Snapshot File
  const handleDownloadBackup = (filename: string, fileId?: string) => {
    let downloadUrl = `/api/admin/system-health?download=${encodeURIComponent(filename)}`;
    if (fileId) {
      downloadUrl += `&fileId=${encodeURIComponent(fileId)}`;
    }
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.info(`Downloading snapshot ${filename}`, 'Download Started');
  };

  const formatUptime = (seconds: number) => {
    if (!seconds) return '0s';
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const formatNextRun = (isoString: string | null) => {
    if (!isoString) return 'Paused';
    const target = new Date(isoString);
    const now = new Date();
    const diffMs = target.getTime() - now.getTime();
    if (diffMs <= 0) return 'Due now';

    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const remainingMins = diffMins % 60;

    const isToday = target.toDateString() === now.toDateString();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrow = target.toDateString() === tomorrow.toDateString();

    const timeStr = target.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let dayPrefix = '';
    if (isToday) dayPrefix = 'Today at ';
    else if (isTomorrow) dayPrefix = 'Tomorrow at ';
    else dayPrefix = `${target.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} at `;

    let countdown = '';
    if (diffHours > 0) {
      countdown = ` (in ${diffHours}h ${remainingMins}m)`;
    } else {
      countdown = ` (in ${diffMins}m)`;
    }

    return `${dayPrefix}${timeStr}${countdown}`;
  };

  const isSupabase = data?.journalMode === 'SUPABASE_POSTGRES';

  // Lightweight Badge Mode (Used on non-system tabs without emojis)
  if (showOnlyBadges) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300 font-mono shadow-xs">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          <span className="font-semibold">{isSupabase ? 'Supabase Engine:' : 'SQLite Engine:'}</span>
          <span>{isSupabase ? 'Cloud Active' : 'WAL Active'} ({data?.pingMs != null ? `${data.pingMs}ms` : '...'})</span>
        </div>

        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 text-blue-800 dark:text-blue-300 font-mono shadow-xs">
          <Database className="w-3.5 h-3.5 text-blue-500 shrink-0" />
          <span className="font-semibold">DB Size:</span>
          <span>{data ? `${data.dbSizeMb} MB` : '...'}</span>
        </div>

        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 text-indigo-800 dark:text-indigo-300 font-mono shadow-xs">
          <HardDrive className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
          <span className="font-semibold">Drive Vault:</span>
          <span>{data?.vault ? `${data.vault.storageUsedGb} GB` : 'Connected'}</span>
        </div>

        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-300 font-mono shadow-xs">
          <Cpu className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <span className="font-semibold">RAM:</span>
          <span>{data ? `${data.memoryMb} MB` : '...'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ========================================================================= */}
      {/* SECTION 1: TOP HEADER & UNIFIED 4-COLUMN KPI TELEMETRY GRID */}
      {/* ========================================================================= */}
      <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-6 shadow-xs transition-colors">
        {/* Header Row */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-100 dark:border-zinc-800/80">
          <div className="flex items-start gap-3.5">
            <div className="p-3 bg-purple-50 dark:bg-purple-950/50 border border-purple-200 dark:border-purple-800/70 text-purple-600 dark:text-purple-400 rounded-xl shrink-0">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                  Database Engine & Disaster Recovery
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                  {isSupabase ? 'Supabase PostgreSQL' : 'WAL Active'}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-indigo-50 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                  {data?.vault?.connected ? 'Google Workspace Drive Linked' : 'Cloud Edition'}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 max-w-2xl leading-relaxed">
                {isSupabase
                  ? 'High-performance cloud database on Supabase PostgreSQL (ap-southeast-2) with connection pooling, automated Gzip (.json.gz) snapshots, and Google Drive vault storage.'
                  : "Zero-downtime hot snapshots via SQLite's atomic VACUUM INTO engine. Multi-slot automated schedules, WAL truncation, and storage telemetry."}
              </p>
            </div>
          </div>

          {/* Action Cluster — Crisp SVG icons with clean labels (NO emojis) */}
          <div className="flex items-center flex-wrap gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleCreateBackup}
              disabled={backupLoading || loading}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-xs rounded-xl flex items-center gap-2 transition-all shadow-sm hover:shadow-indigo-500/20 cursor-pointer whitespace-nowrap"
              title="Create atomic compressed database snapshot to Google Drive"
            >
              <DatabaseBackup className={`w-4 h-4 ${backupLoading ? 'animate-spin' : ''}`} />
              <span>{backupLoading ? 'Creating Snapshot...' : 'Create Hot Backup'}</span>
            </button>

            <button
              type="button"
              onClick={handleOptimizeWal}
              disabled={optimizeLoading || loading}
              className="px-4 py-2 bg-white hover:bg-emerald-50 dark:bg-zinc-800 dark:hover:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800/80 disabled:opacity-50 font-semibold text-xs rounded-xl flex items-center gap-2 transition-all shadow-xs cursor-pointer whitespace-nowrap"
              title="Verify live database connectivity and optimize query planner"
            >
              <Sparkles className={`w-4 h-4 ${optimizeLoading ? 'animate-spin' : ''}`} />
              <span>{optimizeLoading ? 'Checking...' : isSupabase ? 'Verify Cloud Connection' : 'Optimize & Flush WAL'}</span>
            </button>

            <button
              type="button"
              onClick={fetchHealth}
              disabled={loading}
              className="p-2 bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-200 border border-slate-200 dark:border-zinc-700 rounded-xl transition-colors cursor-pointer"
              title="Refresh live telemetry stats"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* 4-Column Unified KPI Grid */}
        <div className="pt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {/* KPI 1: Database Engine */}
          <div className="p-4 rounded-xl bg-slate-50/70 dark:bg-zinc-950/40 border border-slate-200/80 dark:border-zinc-800/70">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase font-mono tracking-wider text-slate-500 dark:text-zinc-400 font-semibold">
                {isSupabase ? 'PostgreSQL Engine' : 'SQLite Engine'}
              </span>
              <Activity className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-xl font-bold font-mono text-emerald-700 dark:text-emerald-400">
                {isSupabase ? 'Cloud Active' : 'WAL Active'}
              </span>
              <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                {data?.pingMs != null ? `${data.pingMs}ms` : '...'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400 font-mono mt-1.5 truncate">
              {isSupabase
                ? 'Supabase Connection Pooler'
                : data
                ? `${data.pageCount} pages @ ${data.pageSize} bytes`
                : 'Loading engine specs...'}
            </p>
          </div>

          {/* KPI 2: Database Footprint */}
          <div className="p-4 rounded-xl bg-slate-50/70 dark:bg-zinc-950/40 border border-slate-200/80 dark:border-zinc-800/70">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase font-mono tracking-wider text-slate-500 dark:text-zinc-400 font-semibold">
                Database Footprint
              </span>
              <Database className="w-4 h-4 text-blue-500" />
            </div>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-xl font-bold font-mono text-slate-900 dark:text-white">
                {data ? `${data.dbSizeMb} MB` : '...'}
              </span>
              <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                {data?.counts?.totalRecords ?? 0} Records
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400 font-mono mt-1.5 truncate">
              {data ? `${data.counts.tasks} tickets • ${data.counts.comments} comments • ${data.counts.users} users` : 'Loading tables...'}
            </p>
          </div>

          {/* KPI 3: Google Workspace Drive Vault */}
          <div className="p-4 rounded-xl bg-slate-50/70 dark:bg-zinc-950/40 border border-slate-200/80 dark:border-zinc-800/70">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase font-mono tracking-wider text-slate-500 dark:text-zinc-400 font-semibold">
                Google Workspace Vault
              </span>
              <HardDrive className="w-4 h-4 text-indigo-500" />
            </div>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-xl font-bold font-mono text-indigo-700 dark:text-indigo-400">
                {data?.vault ? `${data.vault.storageUsedGb} GB` : `${data?.uploadsSizeMb ?? 0} MB`}
              </span>
              <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                {data?.vault?.connected ? 'Drive Online' : 'Local Storage'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400 font-mono mt-1.5 truncate">
              {data?.vault?.connected
                ? 'Attachments & Backups Folders Linked'
                : `${data?.counts.attachments ?? 0} local attachment files`}
            </p>
          </div>

          {/* KPI 4: Runtime & Memory */}
          <div className="p-4 rounded-xl bg-slate-50/70 dark:bg-zinc-950/40 border border-slate-200/80 dark:border-zinc-800/70">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase font-mono tracking-wider text-slate-500 dark:text-zinc-400 font-semibold">
                Runtime & Memory
              </span>
              <Cpu className="w-4 h-4 text-amber-500" />
            </div>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-xl font-bold font-mono text-slate-900 dark:text-white">
                {data ? `${data.memoryMb} MB` : '...'}
              </span>
              <span className="text-xs text-slate-500 dark:text-zinc-400 font-mono">RAM</span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400 font-mono mt-1.5 truncate">
              Server Uptime: {formatUptime(data?.uptimeSeconds ?? 0)}
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* SECTION 2: MULTI-SLOT "AUTOMATED BACKUP SCHEDULES" CONTROL CARD */}
      {/* ========================================================================= */}
      <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-6 shadow-xs transition-colors">
        {/* Top Header Bar of the Scheduler Card */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-zinc-800">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Calendar className="w-4 h-4 text-indigo-500" />
                <span>Automated Backup Schedules (Supabase SystemSetting Persisted)</span>
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-medium">
                {data?.schedule?.schedules?.length ?? 0} configured
              </span>

              {data?.schedule?.enabled ? (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Next run: {formatNextRun(data.schedule.nextRunAt)}</span>
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-medium bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-400 border border-slate-200 dark:border-zinc-700 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                  <span>Paused — Automated runs disabled</span>
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
              Multi-schedule manager saved in database SystemSetting. Backups export all 22 tables, compress via Gzip (.json.gz), and stream to Google Drive.
            </p>
          </div>

          {/* Global Controls: Retention, Auto-WAL, Master Enable */}
          <div className="flex items-center flex-wrap gap-3.5 shrink-0">
            {/* Retention Dropdown */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 dark:text-zinc-400">Retention:</span>
              <select
                disabled={settingsLoading}
                value={data?.schedule?.retentionCount ?? 10}
                onChange={(e) =>
                  handleUpdateSettings({ retentionCount: parseInt(e.target.value, 10) })
                }
                className="text-xs rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-800 dark:text-zinc-200 px-2 py-1.5 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 cursor-pointer"
              >
                <option value={5}>Keep 5</option>
                <option value={10}>Keep 10</option>
                <option value={20}>Keep 20</option>
                <option value={30}>Keep 30</option>
              </select>
            </div>

            {/* Master Enable All Switch */}
            <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800/80 border border-slate-200 dark:border-zinc-700 text-slate-800 dark:text-zinc-200">
              <input
                type="checkbox"
                disabled={settingsLoading}
                checked={data?.schedule?.enabled ?? true}
                onChange={(e) => handleUpdateSettings({ enabled: e.target.checked })}
                className="w-4 h-4 text-indigo-600 rounded border-slate-300 dark:border-zinc-700 focus:ring-indigo-500"
              />
              <span>Enable All</span>
            </label>
          </div>
        </div>

        {/* Active Schedules List */}
        <div className="space-y-2 my-4">
          {data?.schedule?.schedules && data.schedule.schedules.length > 0 ? (
            data.schedule.schedules.map((item) => (
              <div
                key={item.id}
                className={`px-4 py-3 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                  item.enabled
                    ? 'bg-slate-50/80 dark:bg-zinc-950/70 border-slate-200 dark:border-zinc-800/80'
                    : 'bg-slate-100/50 dark:bg-zinc-950/40 border-slate-200/60 dark:border-zinc-800/50 opacity-60'
                }`}
              >
                {/* Left Group */}
                <div className="flex items-center gap-3.5 min-w-0">
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    disabled={togglingScheduleId === item.id}
                    onChange={() => handleToggleScheduleItem(item.id, item.enabled)}
                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 dark:border-zinc-700 focus:ring-indigo-500 cursor-pointer shrink-0"
                    title={item.enabled ? 'Click to pause this schedule' : 'Click to enable this schedule'}
                  />

                  {/* Formatted Time Pill */}
                  <span className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800/60 text-indigo-700 dark:text-indigo-300 font-mono text-xs font-bold shrink-0">
                    {formatScheduleTimePill(item)}
                  </span>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-900 dark:text-zinc-100 truncate">
                        {item.label}
                      </span>
                      <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-200/70 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 border border-slate-300/60 dark:border-zinc-700 font-medium shrink-0">
                        {item.frequency === 'WEEKLY'
                          ? `WEEKLY • ${WEEKDAYS_SHORT[item.dayOfWeek ?? 0]}`
                          : item.frequency}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right Group: Next Run & Actions */}
                <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                  <div className="text-left sm:text-right text-xs text-slate-500 dark:text-zinc-400 font-mono">
                    <p className="text-slate-800 dark:text-zinc-200 font-medium">
                      Next: {formatNextRun(item.nextRunAt)}
                    </p>
                    <div className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5 flex items-center justify-start sm:justify-end gap-1.5">
                      <span>Last run:</span>
                      {item.lastRunAt ? (
                        <>
                          <span>
                            {new Date(item.lastRunAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                          {item.lastRunDurationMs != null && (
                            <span className="text-[10px] text-slate-400">
                              ({item.lastRunDurationMs}ms)
                            </span>
                          )}
                          {item.lastRunStatus === 'SUCCESS' && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                              SUCCESS
                            </span>
                          )}
                          {item.lastRunStatus === 'ERROR' && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                              ERROR
                            </span>
                          )}
                        </>
                      ) : (
                        <span>Never</span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={deletingScheduleId === item.id}
                    onClick={() => handleDeleteScheduleItem(item.id, item.label)}
                    className="w-8 h-8 rounded-lg bg-white dark:bg-zinc-900 hover:bg-rose-50 dark:hover:bg-rose-950/60 border border-slate-200 dark:border-zinc-800 hover:border-rose-300 dark:hover:border-rose-800/60 text-slate-400 hover:text-rose-600 dark:text-zinc-400 dark:hover:text-rose-400 flex items-center justify-center transition-colors cursor-pointer shrink-0 disabled:opacity-50 shadow-2xs"
                    title={`Delete schedule slot '${item.label}'`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="py-6 text-center border border-dashed border-slate-200 dark:border-zinc-800 rounded-xl bg-slate-50/50 dark:bg-zinc-950/40">
              <Clock className="w-6 h-6 text-slate-400 dark:text-zinc-600 mx-auto mb-1.5" />
              <p className="text-xs font-semibold text-slate-700 dark:text-zinc-300">
                No automated backup schedules configured
              </p>
              <p className="text-[11px] text-slate-500 dark:text-zinc-500 mt-0.5">
                Add one or more schedule slots below (e.g. 12:00 PM Midday and 12:00 AM Midnight).
              </p>
            </div>
          )}
        </div>

        {/* Add New Schedule Inline Bar */}
        <form
          onSubmit={handleAddScheduleItem}
          className="pt-4 border-t border-slate-100 dark:border-zinc-800/80 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
        >
          <input
            type="text"
            placeholder="Schedule Label (e.g. Midday Backup 12PM)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            className="flex-1 text-xs rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50/50 dark:bg-zinc-950/50 px-3 py-2 text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
          />

          <select
            value={newFrequency}
            onChange={(e) => setNewFrequency(e.target.value as any)}
            className="text-xs rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-800 dark:text-zinc-200 px-3 py-2 cursor-pointer"
          >
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
            <option value="EVERY_12_HOURS">Every 12h</option>
            <option value="EVERY_6_HOURS">Every 6h</option>
            <option value="HOURLY">Hourly</option>
          </select>

          {newFrequency === 'WEEKLY' && (
            <select
              value={newDayOfWeek}
              onChange={(e) => setNewDayOfWeek(parseInt(e.target.value, 10))}
              className="text-xs rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-800 dark:text-zinc-200 px-3 py-2 cursor-pointer"
            >
              {WEEKDAYS.map((day, idx) => (
                <option key={day} value={idx}>
                  {day}
                </option>
              ))}
            </select>
          )}

          {(newFrequency === 'DAILY' || newFrequency === 'WEEKLY') && (
            <input
              type="time"
              value={newTimeOfDay}
              onChange={(e) => setNewTimeOfDay(e.target.value)}
              className="text-xs rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-800 dark:text-zinc-200 px-3 py-2 cursor-pointer"
            />
          )}

          <button
            type="submit"
            disabled={addingSchedule}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{addingSchedule ? 'Adding...' : 'Add Schedule'}</span>
          </button>
        </form>
      </div>

      {/* ========================================================================= */}
      {/* SECTION 3: RECENT HOT BACKUPS & SYSTEM INTERNALS */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Recent Backups Table */}
        <div className="lg:col-span-8 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-6 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-zinc-800 mb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Cloud className="w-4 h-4 text-indigo-500" />
                <span>Recent Hot Backups {isSupabase && '(Google Drive Vault)'}</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                {isSupabase
                  ? 'Gzip compressed relational exports (.json.gz) stored in the Google Drive Backups folder.'
                  : 'Zero-downtime snapshots created using VACUUM INTO and stored in backups/.'}
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[11px] font-mono bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 font-semibold border border-slate-200 dark:border-zinc-700">
              {data?.recentBackups?.length ?? 0} retained
            </span>
          </div>

          {data?.recentBackups && data.recentBackups.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-zinc-800 text-slate-400 uppercase font-mono text-[10px]">
                    <th className="pb-3 font-semibold">Filename</th>
                    <th className="pb-3 font-semibold">Type</th>
                    <th className="pb-3 font-semibold">Size</th>
                    <th className="pb-3 font-semibold">Created</th>
                    <th className="pb-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/80">
                  {data.recentBackups.map((backup) => (
                    <tr key={backup.fileId || backup.filename} className="hover:bg-slate-50/60 dark:hover:bg-zinc-950/40">
                      <td className="py-3 font-mono text-slate-800 dark:text-zinc-200">
                        <div className="flex items-center gap-1.5">
                          {backup.fileId && <Cloud className="w-3.5 h-3.5 text-indigo-500 shrink-0" />}
                          <span className="truncate max-w-[220px] sm:max-w-xs" title={backup.filename}>
                            {backup.filename}
                          </span>
                        </div>
                      </td>
                      <td className="py-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                            backup.backupType === 'AUTO'
                              ? 'bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800'
                              : 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800'
                          }`}
                        >
                          {backup.backupType}
                        </span>
                      </td>
                      <td className="py-3 font-mono text-slate-600 dark:text-zinc-400">
                        {backup.sizeFormatted}
                      </td>
                      <td className="py-3 text-slate-500 dark:text-zinc-400 font-mono text-[11px]">
                        {new Date(backup.createdAt).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleDownloadBackup(backup.filename, backup.fileId)}
                            className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-800 dark:text-zinc-200 border border-slate-200 dark:border-zinc-700 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                            title="Download backup snapshot"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Download</span>
                          </button>

                          <button
                            type="button"
                            disabled={deletingFilename === backup.filename}
                            onClick={() => handleDeleteBackup(backup.filename, backup.fileId)}
                            className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                            title="Permanently delete snapshot"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center border border-dashed border-slate-200 dark:border-zinc-800 rounded-xl bg-slate-50/50 dark:bg-zinc-950/40 my-auto">
              <HardDrive className="w-8 h-8 text-slate-400 dark:text-zinc-600 mx-auto mb-2" />
              <p className="text-xs font-semibold text-slate-700 dark:text-zinc-300">
                No historical hot backups found
              </p>
              <p className="text-[11px] text-slate-500 dark:text-zinc-500 mt-1 max-w-sm mx-auto">
                Click &quot;Create Hot Backup&quot; to snapshot all 22 database tables into compressed Gzip archives in Google Drive.
              </p>
            </div>
          )}
        </div>

        {/* Right Column: Table Distribution & Cloud Specifications */}
        <div className="lg:col-span-4 space-y-6">
          {/* Card 1: Database Table Distribution */}
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-3 flex items-center gap-2">
              <Server className="w-4 h-4 text-blue-500" />
              <span>Database Table Distribution</span>
            </h3>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-950/60 border border-slate-100 dark:border-zinc-800/80">
                <span className="text-[11px] text-slate-500 dark:text-zinc-400 font-medium">Tickets</span>
                <p className="text-lg font-bold font-mono text-blue-600 dark:text-blue-400 mt-0.5">
                  {data ? data.counts.tasks.toLocaleString() : '...'}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-950/60 border border-slate-100 dark:border-zinc-800/80">
                <span className="text-[11px] text-slate-500 dark:text-zinc-400 font-medium">Comments</span>
                <p className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
                  {data ? data.counts.comments.toLocaleString() : '...'}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-950/60 border border-slate-100 dark:border-zinc-800/80">
                <span className="text-[11px] text-slate-500 dark:text-zinc-400 font-medium">Staff Users</span>
                <p className="text-lg font-bold font-mono text-purple-600 dark:text-purple-400 mt-0.5">
                  {data ? data.counts.users.toLocaleString() : '...'}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-950/60 border border-slate-100 dark:border-zinc-800/80">
                <span className="text-[11px] text-slate-500 dark:text-zinc-400 font-medium">Attachments</span>
                <p className="text-lg font-bold font-mono text-amber-600 dark:text-amber-400 mt-0.5">
                  {data ? data.counts.attachments.toLocaleString() : '...'}
                </p>
              </div>
            </div>
          </div>

          {/* Card 2: Specifications */}
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-3 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-emerald-500" />
              <span>{isSupabase ? 'Cloud Architecture Specs' : 'SQLite Engine Specifications'}</span>
            </h3>
            <div className="space-y-2.5 text-xs font-mono">
              <div className="flex justify-between items-center py-1.5 border-b border-slate-100 dark:border-zinc-800/80">
                <span className="text-slate-500 dark:text-zinc-400">Database Engine:</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400 uppercase">
                  {isSupabase ? 'Supabase PostgreSQL' : 'SQLite WAL'}
                </span>
              </div>
              <div className="flex justify-between items-center py-1.5 border-b border-slate-100 dark:border-zinc-800/80">
                <span className="text-slate-500 dark:text-zinc-400">Storage Provider:</span>
                <span className="text-slate-800 dark:text-zinc-200 font-semibold">
                  {data?.vault?.connected ? 'Google Workspace Drive' : 'Local Disk'}
                </span>
              </div>
              <div className="flex justify-between items-center py-1.5 border-b border-slate-100 dark:border-zinc-800/80">
                <span className="text-slate-500 dark:text-zinc-400">Cloud Region:</span>
                <span className="text-slate-800 dark:text-zinc-200">
                  {isSupabase ? 'ap-southeast-2' : 'Local Host'}
                </span>
              </div>
              <div className="pt-1">
                <span className="text-slate-500 dark:text-zinc-400 text-[11px] block mb-1">
                  Active Database Host:
                </span>
                <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-zinc-950 p-2 rounded-lg border border-slate-200 dark:border-zinc-800">
                  <span
                    className="text-[10px] text-slate-700 dark:text-zinc-300 font-mono truncate flex-1"
                    title={data?.dbPath}
                  >
                    {data?.dbPath || 'Supabase Cloud (ap-southeast-2)'}
                  </span>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
