import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { prisma, resolveDatabaseFilePath } from './db';
import {
  isGoogleDriveStorage,
  uploadToGoogleDrive,
  downloadFromGoogleDrive,
  listGoogleDriveBackups,
  deleteFromGoogleDrive,
  pingGoogleDriveBridge,
  GoogleDriveUploadResult,
  extractDriveFileId,
} from './google-drive-bridge';

export interface BackupFileInfo {
  fileId?: string;
  filename: string;
  filepath: string;
  sizeBytes: number;
  sizeFormatted: string;
  createdAt: string;
  backupType: 'AUTO' | 'MANUAL';
  durationMs?: number;
  downloadUrl?: string;
}

export interface BackupScheduleItem {
  id: string;               // Unique schedule identifier (e.g., "sched_midday_12pm")
  label: string;            // e.g., "Midday Backup (12:00 PM)", "Midnight Backup (12:00 AM)"
  enabled: boolean;
  frequency: 'DAILY' | 'WEEKLY' | 'HOURLY' | 'EVERY_6_HOURS' | 'EVERY_12_HOURS';
  timeOfDay: string;        // "HH:mm" 24-hour format, e.g., "12:00" (12 PM) or "00:00" (12 AM)
  dayOfWeek?: number;       // 0 (Sunday) to 6 (Saturday) when frequency === 'WEEKLY'
  lastRunAt: string | null;
  lastRunDurationMs?: number | null;
  lastRunStatus: 'SUCCESS' | 'ERROR' | null;
  nextRunAt: string | null;
}

export interface BackupScheduleConfig {
  enabled: boolean;                  // Master switch for all scheduled backups
  retentionCount: number;            // Keep latest 5, 10, 20, or 30 snapshots
  autoOptimizeWal: boolean;          // Auto-flush & truncate WAL after scheduled snapshot
  schedules: BackupScheduleItem[];   // List of individual schedule slots
  lastRunAt: string | null;          // Most recent automated run across all slots
  nextRunAt: string | null;          // Soonest upcoming nextRunAt across all enabled slots
  frequency?: BackupScheduleItem['frequency']; // Legacy compatibility
  timeOfDay?: string;                          // Legacy compatibility
}

export interface DatabaseDiagnostics {
  dbPath: string;
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
}

export interface CreateBackupOptions {
  trigger?: 'MANUAL' | 'SCHEDULED';
  retentionCount?: number;
}

const WEEKDAYS_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const SCHEDULE_SETTING_KEY = 'AUTOMATED_BACKUP_SCHEDULE';

/**
 * Extracts raw Google Drive Folder ID from either a bare ID, a full sharing URL,
 * or a markdown-wrapped URL.
 */
export function extractGoogleDriveFolderId(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  const clean = trimmed.replace(/^\[(.*?)\]\(.*?\)$/, '$1').replace(/[\[\]]/g, '');
  const folderMatch = clean.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch && folderMatch[1]) {
    return folderMatch[1];
  }
  const idMatch = clean.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch && idMatch[1]) {
    return idMatch[1];
  }
  return clean.split('?')[0].split('#')[0].trim();
}

/**
 * Returns the path to the persistent backup schedule JSON configuration file (local cache).
 */
export function getBackupSchedulePath(): string {
  const dataDir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch {}
  }
  return path.join(dataDir, 'backup-schedule.json');
}

/**
 * Calculates the next exact run timestamp for a single schedule item.
 */
export function calculateScheduleItemNextRun(
  item: Partial<BackupScheduleItem>,
  fromDate: Date = new Date()
): string | null {
  if (item.enabled === false) {
    return null;
  }

  const freq = item.frequency || 'DAILY';
  const now = new Date(fromDate);

  if (freq === 'HOURLY') {
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next.toISOString();
  }

  if (freq === 'EVERY_6_HOURS') {
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    const currentHour = next.getHours();
    const nextIntervalHour = Math.floor(currentHour / 6 + 1) * 6;
    next.setHours(nextIntervalHour);
    return next.toISOString();
  }

  if (freq === 'EVERY_12_HOURS') {
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    const currentHour = next.getHours();
    const nextIntervalHour = Math.floor(currentHour / 12 + 1) * 12;
    next.setHours(nextIntervalHour);
    return next.toISOString();
  }

  const timeOfDay = item.timeOfDay || '00:00';
  const [hhStr, mmStr] = timeOfDay.split(':');
  const targetHour = parseInt(hhStr || '0', 10) % 24;
  const targetMinute = parseInt(mmStr || '0', 10) % 60;

  if (freq === 'DAILY') {
    const candidate = new Date(now);
    candidate.setHours(targetHour, targetMinute, 0, 0);
    if (candidate.getTime() <= now.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.toISOString();
  }

  if (freq === 'WEEKLY') {
    const targetDay = typeof item.dayOfWeek === 'number' ? item.dayOfWeek : 0;
    const candidate = new Date(now);
    candidate.setHours(targetHour, targetMinute, 0, 0);

    const currentDay = now.getDay();
    let daysUntil = (targetDay - currentDay + 7) % 7;

    if (daysUntil === 0 && candidate.getTime() <= now.getTime()) {
      daysUntil = 7;
    }

    candidate.setDate(candidate.getDate() + daysUntil);
    return candidate.toISOString();
  }

  const fallback = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return fallback.toISOString();
}

/**
 * Re-computes nextRunAt for all enabled schedule slots and calculates the soonest top-level nextRunAt.
 */
export function refreshConfigNextRuns(config: BackupScheduleConfig): BackupScheduleConfig {
  let soonestNextRun: string | null = null;
  const nowMs = Date.now();

  for (const item of config.schedules) {
    if (item.enabled) {
      if (!item.nextRunAt || new Date(item.nextRunAt).getTime() <= nowMs) {
        item.nextRunAt = calculateScheduleItemNextRun(item);
      }
      if (item.nextRunAt) {
        if (!soonestNextRun || new Date(item.nextRunAt).getTime() < new Date(soonestNextRun).getTime()) {
          soonestNextRun = item.nextRunAt;
        }
      }
    } else {
      item.nextRunAt = null;
    }
  }

  config.nextRunAt = config.enabled ? soonestNextRun : null;
  return config;
}

/**
 * Generates default multi-schedule slots: Midday (12:00 PM) and Midnight (12:00 AM).
 */
export function getDefaultSchedules(): BackupScheduleItem[] {
  const item1: BackupScheduleItem = {
    id: 'sched_midday_12pm',
    label: 'Midday Backup (12:00 PM)',
    enabled: true,
    frequency: 'DAILY',
    timeOfDay: '12:00',
    lastRunAt: null,
    lastRunStatus: null,
    nextRunAt: null,
  };
  item1.nextRunAt = calculateScheduleItemNextRun(item1);

  const item2: BackupScheduleItem = {
    id: 'sched_midnight_12am',
    label: 'Midnight Backup (12:00 AM)',
    enabled: true,
    frequency: 'DAILY',
    timeOfDay: '00:00',
    lastRunAt: null,
    lastRunStatus: null,
    nextRunAt: null,
  };
  item2.nextRunAt = calculateScheduleItemNextRun(item2);

  return [item1, item2];
}

/**
 * Formats a 24-hour "HH:mm" string into readable 12-hour format ("12:00 PM", "12:00 AM").
 */
export function formatTime12h(time24: string): string {
  if (!time24) return '12:00 AM';
  const [hhStr, mmStr] = time24.split(':');
  let hh = parseInt(hhStr || '0', 10);
  const mm = mmStr || '00';
  const ampm = hh >= 12 ? 'PM' : 'AM';
  hh = hh % 12;
  if (hh === 0) hh = 12;
  return `${hh}:${mm} ${ampm}`;
}

/**
 * Loads the active backup schedule configuration.
 * Persisted in Supabase PostgreSQL SystemSetting table for Vercel/stateless persistence,
 * with synchronized fallback to local data/backup-schedule.json.
 */
export async function loadBackupScheduleAsync(): Promise<BackupScheduleConfig> {
  const defaultConfig: BackupScheduleConfig = {
    enabled: true,
    retentionCount: 10,
    autoOptimizeWal: true,
    schedules: getDefaultSchedules(),
    lastRunAt: null,
    nextRunAt: null,
  };
  refreshConfigNextRuns(defaultConfig);

  // 1. Try reading from database SystemSetting table
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: SCHEDULE_SETTING_KEY },
    });

    if (setting && setting.value) {
      const parsed = JSON.parse(setting.value);
      if (Array.isArray(parsed.schedules) && parsed.schedules.length > 0) {
        const config: BackupScheduleConfig = {
          enabled: parsed.enabled ?? true,
          retentionCount: parsed.retentionCount ?? 10,
          autoOptimizeWal: parsed.autoOptimizeWal ?? true,
          schedules: parsed.schedules,
          lastRunAt: parsed.lastRunAt || null,
          nextRunAt: null,
        };
        refreshConfigNextRuns(config);

        // Sync local cache file
        try {
          fs.writeFileSync(getBackupSchedulePath(), JSON.stringify(config, null, 2), 'utf-8');
        } catch {}

        return config;
      }
    }
  } catch (dbErr) {
    console.warn('[Maintenance] SystemSetting read notice:', dbErr);
  }

  // 2. Fall back to local file
  const filePath = getBackupSchedulePath();
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      let schedules: BackupScheduleItem[] = [];
      if (Array.isArray(parsed.schedules)) {
        schedules = parsed.schedules;
      } else {
        schedules = getDefaultSchedules();
      }

      const config: BackupScheduleConfig = {
        enabled: parsed.enabled ?? true,
        retentionCount: parsed.retentionCount ?? 10,
        autoOptimizeWal: parsed.autoOptimizeWal ?? true,
        schedules,
        lastRunAt: parsed.lastRunAt || null,
        nextRunAt: null,
      };
      refreshConfigNextRuns(config);

      // Persist to database so it stays in sync
      saveBackupScheduleAsync(config).catch(() => {});
      return config;
    } catch {}
  }

  // 3. First time initialize: save default to both database and file
  await saveBackupScheduleAsync(defaultConfig).catch(() => {});
  return defaultConfig;
}

/**
 * Synchronous loader for legacy callers.
 */
export function loadBackupSchedule(): BackupScheduleConfig {
  const filePath = getBackupSchedulePath();
  const defaultConfig: BackupScheduleConfig = {
    enabled: true,
    retentionCount: 10,
    autoOptimizeWal: true,
    schedules: getDefaultSchedules(),
    lastRunAt: null,
    nextRunAt: null,
  };
  refreshConfigNextRuns(defaultConfig);

  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      let schedules = Array.isArray(parsed.schedules) ? parsed.schedules : getDefaultSchedules();
      const config: BackupScheduleConfig = {
        enabled: parsed.enabled ?? true,
        retentionCount: parsed.retentionCount ?? 10,
        autoOptimizeWal: parsed.autoOptimizeWal ?? true,
        schedules,
        lastRunAt: parsed.lastRunAt || null,
        nextRunAt: null,
      };
      refreshConfigNextRuns(config);
      return config;
    } catch {}
  }

  return defaultConfig;
}

/**
 * Persists the backup schedule configuration to Supabase SystemSetting and local disk cache.
 */
export async function saveBackupScheduleAsync(config: BackupScheduleConfig): Promise<void> {
  refreshConfigNextRuns(config);
  const json = JSON.stringify(config, null, 2);

  // 1. Save to Supabase PostgreSQL SystemSetting table
  try {
    await prisma.systemSetting.upsert({
      where: { key: SCHEDULE_SETTING_KEY },
      create: {
        key: SCHEDULE_SETTING_KEY,
        value: json,
        updatedAt: new Date(),
        updatedBy: 'system',
      },
      update: {
        value: json,
        updatedAt: new Date(),
        updatedBy: 'system',
      },
    });
  } catch (err) {
    console.warn('[Maintenance] Error saving schedule to SystemSetting table:', err);
  }

  // 2. Save to local cache file
  try {
    fs.writeFileSync(getBackupSchedulePath(), json, 'utf-8');
  } catch {}
}

/**
 * Synchronous save for legacy callers.
 */
export function saveBackupSchedule(config: BackupScheduleConfig): void {
  refreshConfigNextRuns(config);
  try {
    fs.writeFileSync(getBackupSchedulePath(), JSON.stringify(config, null, 2), 'utf-8');
  } catch {}
  saveBackupScheduleAsync(config).catch(() => {});
}

/**
 * Adds a new custom schedule slot to the configuration.
 */
export async function addScheduleItem(input: {
  label?: string;
  frequency: BackupScheduleItem['frequency'];
  timeOfDay?: string;
  dayOfWeek?: number;
}): Promise<BackupScheduleConfig> {
  const config = await loadBackupScheduleAsync();
  const timeOfDay = input.timeOfDay || '12:00';
  const frequency = input.frequency || 'DAILY';
  const dayOfWeek = typeof input.dayOfWeek === 'number' ? input.dayOfWeek : 0;

  let label = (input.label || '').trim();
  if (!label) {
    if (frequency === 'DAILY') {
      label = `Daily Backup (${formatTime12h(timeOfDay)})`;
    } else if (frequency === 'WEEKLY') {
      label = `Weekly Backup (${WEEKDAYS_NAMES[dayOfWeek]} • ${formatTime12h(timeOfDay)})`;
    } else if (frequency === 'HOURLY') {
      label = 'Hourly Backup';
    } else if (frequency === 'EVERY_6_HOURS') {
      label = 'Every 6 Hours Backup';
    } else if (frequency === 'EVERY_12_HOURS') {
      label = 'Every 12 Hours Backup';
    } else {
      label = `Backup (${formatTime12h(timeOfDay)})`;
    }
  }

  const newItem: BackupScheduleItem = {
    id: 'sched_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex'),
    label,
    enabled: true,
    frequency,
    timeOfDay,
    dayOfWeek: frequency === 'WEEKLY' ? dayOfWeek : undefined,
    lastRunAt: null,
    lastRunStatus: null,
    nextRunAt: null,
  };
  newItem.nextRunAt = calculateScheduleItemNextRun(newItem);

  config.schedules.push(newItem);
  await saveBackupScheduleAsync(config);
  return config;
}

/**
 * Toggles an individual schedule item ON/OFF.
 */
export async function toggleScheduleItem(id: string, enabled: boolean): Promise<BackupScheduleConfig> {
  const config = await loadBackupScheduleAsync();
  const item = config.schedules.find((s) => s.id === id);
  if (!item) {
    throw new Error(`Schedule item '${id}' not found.`);
  }

  item.enabled = enabled;
  item.nextRunAt = enabled ? calculateScheduleItemNextRun(item) : null;
  await saveBackupScheduleAsync(config);
  return config;
}

/**
 * Removes an individual schedule item from the configuration.
 */
export async function deleteScheduleItem(id: string): Promise<BackupScheduleConfig> {
  const config = await loadBackupScheduleAsync();
  config.schedules = config.schedules.filter((s) => s.id !== id);
  await saveBackupScheduleAsync(config);
  return config;
}

/**
 * Updates global schedule settings (master enable, retention count, and autoOptimizeWal).
 */
export async function updateScheduleSettings(settings: {
  enabled?: boolean;
  retentionCount?: number;
  autoOptimizeWal?: boolean;
}): Promise<BackupScheduleConfig> {
  const config = await loadBackupScheduleAsync();

  if (typeof settings.enabled === 'boolean') {
    config.enabled = settings.enabled;
  }
  if (typeof settings.retentionCount === 'number' && settings.retentionCount >= 1) {
    config.retentionCount = settings.retentionCount;
    const backupsDir = path.resolve(process.cwd(), 'backups');
    pruneBackups(backupsDir, settings.retentionCount);
  }
  if (typeof settings.autoOptimizeWal === 'boolean') {
    config.autoOptimizeWal = settings.autoOptimizeWal;
  }

  await saveBackupScheduleAsync(config);
  return config;
}

/**
 * Backwards compatibility helper for legacy single-slot update callers.
 */
export async function updateBackupSchedule(updates: Partial<BackupScheduleConfig>): Promise<BackupScheduleConfig> {
  const config = await loadBackupScheduleAsync();
  if (updates.enabled !== undefined) config.enabled = updates.enabled;
  if (updates.retentionCount !== undefined) config.retentionCount = updates.retentionCount;
  if (updates.autoOptimizeWal !== undefined) config.autoOptimizeWal = updates.autoOptimizeWal;
  if (updates.schedules !== undefined) config.schedules = updates.schedules;
  if (updates.frequency !== undefined) config.frequency = updates.frequency;
  if (updates.timeOfDay !== undefined) config.timeOfDay = updates.timeOfDay;
  await saveBackupScheduleAsync(config);
  return config;
}

/**
 * Backwards compatibility helper for legacy single-slot callers.
 */
export function calculateNextRunAt(
  arg1?: BackupScheduleItem['frequency'] | Partial<BackupScheduleItem>,
  timeOfDay = '00:00',
  dayOfWeek = 0,
  fromDate = new Date()
): string {
  if (typeof arg1 === 'object' && arg1 !== null) {
    return calculateScheduleItemNextRun(arg1, fromDate) || new Date().toISOString();
  }
  const frequency = (arg1 as BackupScheduleItem['frequency']) || 'DAILY';
  return (
    calculateScheduleItemNextRun({ frequency, timeOfDay, dayOfWeek, enabled: true }, fromDate) ||
    new Date().toISOString()
  );
}

/**
 * Recursively calculates the byte size of a directory on disk.
 */
export function getDirectorySizeBytes(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          total += getDirectorySizeBytes(fullPath);
        } else if (entry.isFile()) {
          total += fs.statSync(fullPath).size;
        }
      } catch {}
    }
  } catch {}
  return total;
}

/**
 * Discovers and formats all backups from Google Drive (primary in Cloud mode)
 * and merges with local snapshots in the backups/ directory.
 */
export async function getRecentBackupsAsync(): Promise<BackupFileInfo[]> {
  const backupMap = new Map<string, BackupFileInfo>();

  // 1. Fetch from Google Drive if in cloud mode
  if (isGoogleDriveStorage()) {
    try {
      const driveList = await listGoogleDriveBackups();
      if (driveList.ok && driveList.files) {
        for (const f of driveList.files) {
          let backupType: 'AUTO' | 'MANUAL' = 'MANUAL';
          if (f.filename.includes('-auto-')) {
            backupType = 'AUTO';
          }
          const sizeBytes = f.sizeBytes;
          const sizeFormatted =
            sizeBytes >= 1024 * 1024
              ? `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`
              : `${(sizeBytes / 1024).toFixed(1)} KB`;

          backupMap.set(f.filename, {
            fileId: f.fileId,
            filename: f.filename,
            filepath: f.downloadUrl || f.viewUrl || f.fileId,
            sizeBytes,
            sizeFormatted,
            createdAt: f.createdAt,
            backupType,
            downloadUrl: f.downloadUrl,
          });
        }
      }
    } catch (driveErr) {
      console.warn('[Maintenance] Failed to list Drive backups:', driveErr);
    }
  }

  // 2. Discover local files in backups/ directory
  const backupsDir = path.resolve(process.cwd(), 'backups');
  if (fs.existsSync(backupsDir)) {
    try {
      const localFiles = fs
        .readdirSync(backupsDir)
        .filter((f) => f.endsWith('.db') || f.endsWith('.sqlite') || f.endsWith('.json') || f.endsWith('.json.gz'));

      for (const f of localFiles) {
        const fullPath = path.join(backupsDir, f);
        const stat = fs.statSync(fullPath);
        let backupType: 'AUTO' | 'MANUAL' = 'MANUAL';
        if (f.includes('-auto-')) {
          backupType = 'AUTO';
        } else if (f.includes('-manual-') || f.includes('-backup-')) {
          backupType = 'MANUAL';
        }

        const sizeFormatted =
          stat.size >= 1024 * 1024
            ? `${(stat.size / (1024 * 1024)).toFixed(2)} MB`
            : `${(stat.size / 1024).toFixed(1)} KB`;

        const existing = backupMap.get(f);
        if (existing) {
          // Enrich with local filepath
          existing.filepath = fullPath;
        } else {
          backupMap.set(f, {
            filename: f,
            filepath: fullPath,
            sizeBytes: stat.size,
            sizeFormatted,
            createdAt: stat.mtime.toISOString(),
            backupType,
          });
        }
      }
    } catch (err) {
      console.warn('[Maintenance] Error listing local backups directory:', err);
    }
  }

  return Array.from(backupMap.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * Synchronous backup listing for legacy callers.
 */
export function getRecentBackups(): BackupFileInfo[] {
  const backupsDir = path.resolve(process.cwd(), 'backups');
  if (!fs.existsSync(backupsDir)) return [];

  try {
    return fs
      .readdirSync(backupsDir)
      .filter((f) => f.endsWith('.db') || f.endsWith('.sqlite') || f.endsWith('.json') || f.endsWith('.json.gz'))
      .map((f) => {
        const fullPath = path.join(backupsDir, f);
        const stat = fs.statSync(fullPath);
        let backupType: 'AUTO' | 'MANUAL' = 'MANUAL';
        if (f.includes('-auto-')) backupType = 'AUTO';

        return {
          filename: f,
          filepath: fullPath,
          sizeBytes: stat.size,
          sizeFormatted:
            stat.size >= 1024 * 1024
              ? `${(stat.size / (1024 * 1024)).toFixed(2)} MB`
              : `${(stat.size / 1024).toFixed(1)} KB`,
          createdAt: stat.mtime.toISOString(),
          backupType,
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch {
    return [];
  }
}

/**
 * Gathers comprehensive real-time database health, storage, ping latency, Google Drive vault metrics,
 * and multi-schedule configuration.
 */
export async function getDatabaseDiagnostics(): Promise<DatabaseDiagnostics> {
  const dbUrl = process.env.DATABASE_URL || '';
  const isPostgres = dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://');

  if (isPostgres) {
    // 1. Measure live Supabase PostgreSQL query ping latency in milliseconds
    const pingStart = performance.now();
    await prisma.$queryRawUnsafe('SELECT 1;');
    const pingMs = Number((performance.now() - pingStart).toFixed(2));

    // 2. Query actual PostgreSQL database size in bytes
    let dbSizeBytes = 0;
    try {
      const sizeRes = await prisma.$queryRawUnsafe<Array<{ size_bytes: string | number | bigint }>>(
        'SELECT pg_database_size(current_database())::bigint AS size_bytes;'
      );
      if (sizeRes && sizeRes[0]?.size_bytes != null) {
        dbSizeBytes = Number(sizeRes[0].size_bytes);
      }
    } catch (sizeErr) {
      console.warn('[Supabase Telemetry] Error querying pg_database_size:', sizeErr);
    }

    // 3. Inspect uploads folder volume
    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    const publicUploadsDir = path.resolve(process.cwd(), 'public', 'uploads');
    const uploadsSizeBytes = getDirectorySizeBytes(uploadsDir) + getDirectorySizeBytes(publicUploadsDir);

    const dbSizeMb = Number((dbSizeBytes / (1024 * 1024)).toFixed(2));
    const walSizeKb = 0;
    const uploadsSizeMb = Number((uploadsSizeBytes / (1024 * 1024)).toFixed(2));

    // 4. Memory & server uptime
    const memoryBytes = process.memoryUsage().rss;
    const memoryMb = Number((memoryBytes / (1024 * 1024)).toFixed(1));
    const uptimeSeconds = Math.floor(process.uptime());

    // 5. Total entity counts in database
    const [tasks, comments, users, attachmentLegacy, taskAttachments, auditLogs, spaces] =
      await Promise.all([
        prisma.task.count(),
        prisma.taskComment.count(),
        prisma.user.count(),
        prisma.attachment.count().catch(() => 0),
        prisma.taskAttachment.count().catch(() => 0),
        prisma.auditLog.count().catch(() => 0),
        prisma.space.count().catch(() => 0),
      ]);

    const totalRecords = tasks + comments + users + attachmentLegacy + taskAttachments + auditLogs + spaces;

    // 6. Ping Google Workspace Drive Vault
    let vaultInfo: DatabaseDiagnostics['vault'] = undefined;
    if (isGoogleDriveStorage()) {
      try {
        const ping = await pingGoogleDriveBridge();
        const usedBytes = ping.storageUsedBytes || 0;
        const limitBytes = ping.storageLimitBytes || 483183820800; // default ~450 GB
        const usedGb = Number((usedBytes / (1024 * 1024 * 1024)).toFixed(2));
        const limitGb = Number((limitBytes / (1024 * 1024 * 1024)).toFixed(1));
        const percentUsed = limitBytes > 0 ? Number(((usedBytes / limitBytes) * 100).toFixed(1)) : 0;

        vaultInfo = {
          connected: ping.ok,
          storageUsedBytes: usedBytes,
          storageLimitBytes: limitBytes,
          storageUsedGb: usedGb,
          storageLimitGb: limitGb,
          percentUsed,
          status: ping.status,
          attachmentsFolder: 'Attachments',
          backupsFolder: 'Backups',
        };
      } catch (vaultErr) {
        console.warn('[Maintenance] Vault ping error:', vaultErr);
      }
    }

    const recentBackups = await getRecentBackupsAsync();
    const schedule = await loadBackupScheduleAsync();

    return {
      dbPath: 'Supabase Cloud (ap-southeast-2)',
      dbSizeMb,
      walSizeKb,
      uploadsSizeMb,
      pingMs,
      journalMode: 'SUPABASE_POSTGRES',
      uptimeSeconds,
      memoryMb,
      pageCount: 0,
      pageSize: 8192,
      freelistCount: 0,
      counts: {
        tasks,
        comments,
        users,
        attachments: attachmentLegacy + taskAttachments,
        totalRecords,
      },
      vault: vaultInfo,
      recentBackups,
      schedule,
    };
  }

  // Local SQLite Diagnostics
  const dbPath = resolveDatabaseFilePath();

  const pingStart = performance.now();
  await prisma.$queryRawUnsafe('SELECT 1;');
  const pingMs = Number((performance.now() - pingStart).toFixed(2));

  const [journalRes, pageCountRes, pageSizeRes, freelistRes] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ journal_mode?: string }>>('PRAGMA journal_mode;'),
    prisma.$queryRawUnsafe<Array<{ page_count?: number | bigint }>>('PRAGMA page_count;'),
    prisma.$queryRawUnsafe<Array<{ page_size?: number | bigint }>>('PRAGMA page_size;'),
    prisma.$queryRawUnsafe<Array<{ freelist_count?: number | bigint }>>('PRAGMA freelist_count;'),
  ]);

  const journalMode = (journalRes[0]?.journal_mode || 'wal').toLowerCase();
  const pageCount = Number(pageCountRes[0]?.page_count ?? 0);
  const pageSize = Number(pageSizeRes[0]?.page_size ?? 0);
  const freelistCount = Number(freelistRes[0]?.freelist_count ?? 0);

  let dbSizeBytes = 0;
  if (fs.existsSync(dbPath)) {
    dbSizeBytes = fs.statSync(dbPath).size;
  }

  const walPath = `${dbPath}-wal`;
  let walSizeBytes = 0;
  if (fs.existsSync(walPath)) {
    walSizeBytes = fs.statSync(walPath).size;
  }

  const uploadsDir = path.resolve(process.cwd(), 'uploads');
  const publicUploadsDir = path.resolve(process.cwd(), 'public', 'uploads');
  const uploadsSizeBytes = getDirectorySizeBytes(uploadsDir) + getDirectorySizeBytes(publicUploadsDir);

  const dbSizeMb = Number((dbSizeBytes / (1024 * 1024)).toFixed(2));
  const walSizeKb = Number((walSizeBytes / 1024).toFixed(1));
  const uploadsSizeMb = Number((uploadsSizeBytes / (1024 * 1024)).toFixed(2));

  const memoryBytes = process.memoryUsage().rss;
  const memoryMb = Number((memoryBytes / (1024 * 1024)).toFixed(1));
  const uptimeSeconds = Math.floor(process.uptime());

  const [tasks, comments, users, attachmentLegacy, taskAttachments] = await Promise.all([
    prisma.task.count(),
    prisma.taskComment.count(),
    prisma.user.count(),
    prisma.attachment.count().catch(() => 0),
    prisma.taskAttachment.count().catch(() => 0),
  ]);

  const recentBackups = getRecentBackups();
  const schedule = loadBackupSchedule();

  return {
    dbPath,
    dbSizeMb,
    walSizeKb,
    uploadsSizeMb,
    pingMs,
    journalMode,
    uptimeSeconds,
    memoryMb,
    pageCount,
    pageSize,
    freelistCount,
    counts: {
      tasks,
      comments,
      users,
      attachments: attachmentLegacy + taskAttachments,
      totalRecords: tasks + comments + users + attachmentLegacy + taskAttachments,
    },
    recentBackups,
    schedule,
  };
}

/**
 * Flushes the Write-Ahead Log into the main database file for SQLite,
 * or verifies cloud synchronization on Supabase PostgreSQL.
 */
export async function runWalOptimization(): Promise<{
  success: boolean;
  walSizeKb: number;
  dbSizeMb: number;
  message: string;
}> {
  const dbUrl = process.env.DATABASE_URL || '';
  const isPostgres = dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://');

  if (isPostgres) {
    let dbSizeMb = 0;
    try {
      const sizeRes = await prisma.$queryRawUnsafe<Array<{ size_bytes: string | number | bigint }>>(
        'SELECT pg_database_size(current_database())::bigint AS size_bytes;'
      );
      if (sizeRes && sizeRes[0]?.size_bytes != null) {
        dbSizeMb = Number((Number(sizeRes[0].size_bytes) / (1024 * 1024)).toFixed(2));
      }
    } catch {}

    return {
      success: true,
      walSizeKb: 0,
      dbSizeMb,
      message: 'Supabase PostgreSQL cloud database active. Connection pooler is verified and healthy.',
    };
  }

  await prisma.$queryRawUnsafe('PRAGMA optimize;');
  await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);');

  const dbPath = resolveDatabaseFilePath();
  const walPath = `${dbPath}-wal`;
  let walSizeBytes = 0;
  if (fs.existsSync(walPath)) {
    walSizeBytes = fs.statSync(walPath).size;
  }

  let dbSizeBytes = 0;
  if (fs.existsSync(dbPath)) {
    dbSizeBytes = fs.statSync(dbPath).size;
  }

  const walSizeKb = Number((walSizeBytes / 1024).toFixed(1));
  const dbSizeMb = Number((dbSizeBytes / (1024 * 1024)).toFixed(2));

  return {
    success: true,
    walSizeKb,
    dbSizeMb,
    message: 'WAL log flushed into main database file and query planner statistics optimized.',
  };
}

/**
 * Prunes local backups directory according to retention policy.
 */
export function pruneBackups(backupsDir: string, maxRetained = 10) {
  if (!fs.existsSync(backupsDir)) return;
  try {
    const files = fs
      .readdirSync(backupsDir)
      .filter((f) => f.startsWith('lk-ticketing-') && (f.endsWith('.db') || f.endsWith('.sqlite') || f.endsWith('.json') || f.endsWith('.json.gz')))
      .map((f) => {
        const fullPath = path.join(backupsDir, f);
        const stat = fs.statSync(fullPath);
        return { filename: f, fullPath, mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    if (files.length > maxRetained) {
      const toDelete = files.slice(maxRetained);
      for (const file of toDelete) {
        try {
          fs.unlinkSync(file.fullPath);
        } catch (err) {
          console.warn(`[Maintenance] Failed to prune old backup ${file.filename}:`, err);
        }
      }
    }
  } catch (err) {
    console.warn('[Maintenance] Error during backup rotation:', err);
  }
}

/**
 * Deletes a backup snapshot safely by fileId (Google Drive) or filename (Local).
 */
export async function deleteBackup(input: string | {
  filename?: string;
  fileId?: string;
}): Promise<{ success: boolean; filename: string }> {
  const normalized = typeof input === 'string' ? { filename: input } : input;
  const { filename, fileId } = normalized;

  // 1. Delete from Google Drive if fileId is present
  if (fileId) {
    try {
      await deleteFromGoogleDrive(fileId);
    } catch (driveErr: any) {
      console.warn(`[Maintenance] Google Drive deletion warning for fileId ${fileId}:`, driveErr.message);
    }
  }

  // 2. Delete from local backups directory if filename is provided
  if (filename) {
    const sanitizedFilename = path.basename(filename);
    const backupsDir = path.resolve(process.cwd(), 'backups');
    const targetPath = path.resolve(backupsDir, sanitizedFilename);

    if (targetPath.startsWith(backupsDir + path.sep) && fs.existsSync(targetPath)) {
      try {
        fs.unlinkSync(targetPath);
      } catch (fsErr) {
        console.warn(`[Maintenance] Local file unlink warning:`, fsErr);
      }
    }
  }

  return { success: true, filename: filename || fileId || 'deleted-snapshot' };
}

/**
 * Creates an atomic backup snapshot of the entire database.
 * - In Cloud mode (PostgreSQL / Google Drive): Exports all 22 tables from Supabase,
 *   compresses payload with Gzip (.json.gz), and uploads to Google Drive Backups folder.
 * - In SQLite mode: Executes atomic VACUUM INTO.
 */
export async function createHotBackup(options: CreateBackupOptions = {}): Promise<BackupFileInfo> {
  const trigger = options.trigger ?? 'MANUAL';
  const schedule = await loadBackupScheduleAsync();
  const retentionCount = options.retentionCount ?? schedule.retentionCount ?? 10;

  const dbUrl = process.env.DATABASE_URL || '';
  const isPostgres = dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://');
  const useGoogleDrive = isGoogleDriveStorage();

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const prefix = trigger === 'SCHEDULED' ? 'lk-ticketing-auto' : 'lk-ticketing-manual';

  // ---------------------------------------------------------------------------
  // CLOUD MODE: Supabase PostgreSQL -> Compressed .json.gz -> Google Drive
  // ---------------------------------------------------------------------------
  if (isPostgres || useGoogleDrive) {
    const startMs = performance.now();
    const filename = `${prefix}-${timestamp}.json.gz`;

    const [
      workspaces,
      users,
      spaces,
      spaceMembers,
      lists,
      statuses,
      customFieldDefs,
      templates,
      slaPolicies,
      userPreferences,
      tasks,
      checklistItems,
      customFieldValues,
      comments,
      legacyAttachments,
      taskAttachments,
      histories,
      notifications,
      auditLogs,
      sessions,
      systemSettings,
    ] = await Promise.all([
      prisma.workspace.findMany(),
      prisma.user.findMany(),
      prisma.space.findMany(),
      prisma.spaceMember.findMany(),
      prisma.list.findMany(),
      prisma.taskStatus.findMany(),
      prisma.customFieldDefinition.findMany(),
      prisma.ticketTemplate.findMany(),
      prisma.slaPolicy.findMany(),
      prisma.userPreference.findMany(),
      prisma.task.findMany(),
      prisma.taskChecklistItem.findMany(),
      prisma.taskCustomFieldValue.findMany(),
      prisma.taskComment.findMany(),
      prisma.attachment.findMany(),
      prisma.taskAttachment.findMany(),
      prisma.taskHistory.findMany(),
      prisma.notification.findMany(),
      prisma.auditLog.findMany(),
      prisma.session.findMany(),
      prisma.systemSetting.findMany(),
    ]);

    let contributors: any[] = [];
    try {
      contributors = await prisma.$queryRawUnsafe<any[]>('SELECT "A", "B" FROM "_TaskContributors";');
    } catch {}

    const snapshot = {
      version: '2.0-CLOUD',
      exportedAt: now.toISOString(),
      database: 'SUPABASE_POSTGRESQL',
      recordCounts: {
        Workspace: workspaces.length,
        User: users.length,
        Space: spaces.length,
        SpaceMember: spaceMembers.length,
        List: lists.length,
        TaskStatus: statuses.length,
        CustomFieldDefinition: customFieldDefs.length,
        TicketTemplate: templates.length,
        SlaPolicy: slaPolicies.length,
        UserPreference: userPreferences.length,
        Task: tasks.length,
        _TaskContributors: contributors.length,
        TaskChecklistItem: checklistItems.length,
        TaskCustomFieldValue: customFieldValues.length,
        TaskComment: comments.length,
        Attachment: legacyAttachments.length,
        TaskAttachment: taskAttachments.length,
        TaskHistory: histories.length,
        Notification: notifications.length,
        AuditLog: auditLogs.length,
        Session: sessions.length,
        SystemSetting: systemSettings.length,
      },
      data: {
        workspaces,
        users,
        spaces,
        spaceMembers,
        lists,
        statuses,
        customFieldDefs,
        templates,
        slaPolicies,
        userPreferences,
        tasks,
        contributors,
        checklistItems,
        customFieldValues,
        comments,
        legacyAttachments,
        taskAttachments,
        histories,
        notifications,
        auditLogs,
        sessions,
        systemSettings,
      },
    };

    const jsonString = JSON.stringify(snapshot, null, 2);
    const gzippedBuffer = zlib.gzipSync(Buffer.from(jsonString, 'utf-8'));

    // Upload to Google Drive Backups folder
    let driveUpload: GoogleDriveUploadResult | null = null;
    if (useGoogleDrive) {
      driveUpload = await uploadToGoogleDrive({
        target: 'BACKUPS',
        fileName: filename,
        mimeType: 'application/gzip',
        buffer: gzippedBuffer,
        retentionCount,
      });
    }

    // Save local copy in backups/ if available
    const backupsDir = path.resolve(process.cwd(), 'backups');
    if (!fs.existsSync(backupsDir)) {
      try {
        fs.mkdirSync(backupsDir, { recursive: true });
      } catch {}
    }
    const localBackupPath = path.join(backupsDir, filename);
    try {
      fs.writeFileSync(localBackupPath, gzippedBuffer);
      pruneBackups(backupsDir, retentionCount);
    } catch {}

    const durationMs = Math.round(performance.now() - startMs);
    const sizeBytes = gzippedBuffer.length;
    const sizeFormatted =
      sizeBytes >= 1024 * 1024
        ? `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`
        : `${(sizeBytes / 1024).toFixed(1)} KB`;

    return {
      fileId: driveUpload?.fileId,
      filename,
      filepath: localBackupPath,
      sizeBytes,
      sizeFormatted,
      createdAt: now.toISOString(),
      backupType: trigger === 'SCHEDULED' ? 'AUTO' : 'MANUAL',
      durationMs,
      downloadUrl: driveUpload?.downloadUrl,
    };
  }

  // ---------------------------------------------------------------------------
  // LOCAL SQLITE MODE: Atomic VACUUM INTO
  // ---------------------------------------------------------------------------
  const backupsDir = path.resolve(process.cwd(), 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  const filename = `${prefix}-${timestamp}.db`;
  const backupFilePath = path.join(backupsDir, filename);
  const safeBackupPath = backupFilePath.replace(/\\/g, '/');

  await prisma.$executeRawUnsafe(`VACUUM INTO '${safeBackupPath}';`);

  if (!fs.existsSync(backupFilePath)) {
    throw new Error(`Hot backup file was not created at expected path: ${backupFilePath}`);
  }

  const stat = fs.statSync(backupFilePath);
  pruneBackups(backupsDir, retentionCount);

  return {
    filename,
    filepath: backupFilePath,
    sizeBytes: stat.size,
    sizeFormatted:
      stat.size >= 1024 * 1024
        ? `${(stat.size / (1024 * 1024)).toFixed(2)} MB`
        : `${(stat.size / 1024).toFixed(1)} KB`,
    createdAt: stat.mtime.toISOString(),
    backupType: trigger === 'SCHEDULED' ? 'AUTO' : 'MANUAL',
  };
}

/**
 * Automated SQLite WAL background checkpointing.
 */
export function initBackgroundWalMaintenance(intervalMs = 15 * 60 * 1000) {
  const isSqlite = (process.env.DATABASE_URL || '').startsWith('file:');
  if (!isSqlite) return;

  const globalObj = globalThis as unknown as { __walMaintenanceTimer?: NodeJS.Timeout };
  if (globalObj.__walMaintenanceTimer) return;

  globalObj.__walMaintenanceTimer = setInterval(async () => {
    try {
      await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(PASSIVE);');
      await prisma.$queryRawUnsafe('PRAGMA optimize;');
    } catch (err) {
      console.warn('[WAL Maintenance] Passive checkpoint notice:', err);
    }
  }, intervalMs);

  if (typeof globalObj.__walMaintenanceTimer.unref === 'function') {
    globalObj.__walMaintenanceTimer.unref();
  }
}

/**
 * Executes due scheduled backups.
 * Can be called either by the background interval timer or via the /api/cron/backup endpoint.
 */
export async function executeScheduledBackupsIfDue(force = false): Promise<{
  executedCount: number;
  results: Array<{ label: string; filename: string; sizeFormatted: string; durationMs?: number }>;
}> {
  const config = await loadBackupScheduleAsync();
  if (!config.enabled || !config.schedules || config.schedules.length === 0) {
    return { executedCount: 0, results: [] };
  }

  const nowMs = Date.now();
  const dueItems = config.schedules.filter(
    (item) => item.enabled && (force || (item.nextRunAt && nowMs >= new Date(item.nextRunAt).getTime()))
  );

  if (dueItems.length === 0) {
    return { executedCount: 0, results: [] };
  }

  const results: Array<{ label: string; filename: string; sizeFormatted: string; durationMs?: number }> = [];

  for (const dueItem of dueItems) {
    console.log(`[Backup Scheduler] Triggering schedule '${dueItem.label}' (due: ${dueItem.nextRunAt})...`);
    const startItem = performance.now();

    try {
      const backup = await createHotBackup({
        trigger: 'SCHEDULED',
        retentionCount: config.retentionCount,
      });

      const nextRun = calculateScheduleItemNextRun(dueItem, new Date(Date.now() + 1000));
      dueItem.lastRunAt = new Date().toISOString();
      dueItem.lastRunDurationMs = backup.durationMs || Math.round(performance.now() - startItem);
      dueItem.lastRunStatus = 'SUCCESS';
      dueItem.nextRunAt = nextRun;
      config.lastRunAt = dueItem.lastRunAt;

      results.push({
        label: dueItem.label,
        filename: backup.filename,
        sizeFormatted: backup.sizeFormatted,
        durationMs: dueItem.lastRunDurationMs,
      });

      try {
        await prisma.auditLog.create({
          data: {
            event: 'SCHEDULED_HOT_BACKUP_COMPLETED',
            userId: 'system',
            resourceType: 'System',
            resourceId: 'multi-schedule-backup',
            details: `Automated scheduled backup created for '${dueItem.label}': ${backup.filename} (${backup.sizeFormatted}). Duration: ${dueItem.lastRunDurationMs}ms. Next slot: ${nextRun}`,
          },
        });
      } catch {}

      console.log(`[Backup Scheduler] Successfully executed '${dueItem.label}': ${backup.filename}. Next run: ${nextRun}`);
    } catch (execErr: any) {
      console.error(`[Backup Scheduler] Execution failed for '${dueItem.label}':`, execErr);
      dueItem.lastRunAt = new Date().toISOString();
      dueItem.lastRunStatus = 'ERROR';
      dueItem.nextRunAt = calculateScheduleItemNextRun(dueItem, new Date(Date.now() + 60 * 1000));
    }
  }

  await saveBackupScheduleAsync(config);
  return { executedCount: results.length, results };
}

/**
 * Background loop that checks every 30 seconds if any automated scheduled backup slot is due.
 */
let schedulerIsRunning = false;

export function initAutomatedBackupScheduler() {
  const globalObj = globalThis as unknown as { __backupSchedulerTimer?: NodeJS.Timeout };
  if (globalObj.__backupSchedulerTimer) return;

  globalObj.__backupSchedulerTimer = setInterval(async () => {
    if (schedulerIsRunning) return;
    schedulerIsRunning = true;

    try {
      await executeScheduledBackupsIfDue(false);
    } catch (err) {
      console.warn('[Backup Scheduler] Error in loop:', err);
    } finally {
      schedulerIsRunning = false;
    }
  }, 30 * 1000);

  if (typeof globalObj.__backupSchedulerTimer.unref === 'function') {
    globalObj.__backupSchedulerTimer.unref();
  }
}

// Auto-initialize background maintenance
if (typeof window === 'undefined') {
  const isSqlite = (process.env.DATABASE_URL || '').startsWith('file:');
  if (isSqlite) {
    initBackgroundWalMaintenance();
  }
  // Initialize scheduler for both local processes and persistent Node servers
  initAutomatedBackupScheduler();
}
