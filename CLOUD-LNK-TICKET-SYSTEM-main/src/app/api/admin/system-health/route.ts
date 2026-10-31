import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import {
  getDatabaseDiagnostics,
  runWalOptimization,
  createHotBackup,
  loadBackupScheduleAsync,
  saveBackupScheduleAsync,
  addScheduleItem,
  toggleScheduleItem,
  deleteScheduleItem,
  updateScheduleSettings,
  deleteBackup,
  getRecentBackupsAsync,
  BackupScheduleConfig,
} from '@/lib/sqlite-maintenance';
import { downloadFromGoogleDrive } from '@/lib/google-drive-bridge';
import { getOrSetCache, invalidateCachePrefix } from '@/lib/server-cache';

async function getAuthenticatedSuperadmin(request: NextRequest) {
  let token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authHeader = request.headers.get('authorization');
  if (!token && authHeader?.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  if (!token) {
    return { error: 'Unauthorized: Authentication required.', status: 401 };
  }

  const sessionData = await validateSession(token);
  if (!sessionData) {
    return { error: 'Unauthorized: Session is expired or invalid.', status: 401 };
  }

  if (sessionData.user.globalRole !== 'SUPERADMIN') {
    return {
      error: 'Forbidden: Superadmin clearance required to access system health diagnostics and database backups.',
      status: 403,
    };
  }

  return { user: sessionData.user };
}

/**
 * GET /api/admin/system-health
 * Returns real-time database health diagnostics, file sizes, memory, multi-schedule config, and backup lists.
 * Supports optional ?download=<filename>&fileId=<fileId> to download backup snapshots from Google Drive or local storage.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedSuperadmin(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const downloadFilename = request.nextUrl.searchParams.get('download') || request.nextUrl.searchParams.get('filename');
    const downloadFileId = request.nextUrl.searchParams.get('fileId');

    // 1. Download from Google Drive if fileId is specified
    if (downloadFileId) {
      try {
        const driveFile = await downloadFromGoogleDrive(downloadFileId);
        const fileName = downloadFilename || driveFile.fileName || 'backup.json.gz';
        const contentType = fileName.endsWith('.json.gz')
          ? 'application/gzip'
          : fileName.endsWith('.json')
          ? 'application/json'
          : driveFile.mimeType || 'application/octet-stream';

        return new NextResponse(new Uint8Array(driveFile.buffer), {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
            'Content-Length': driveFile.buffer.length.toString(),
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          },
        });
      } catch (driveErr: any) {
        console.warn('[System Health] Drive download failed, attempting local fallback:', driveErr.message);
      }
    }

    // 2. Download from local backups directory
    if (downloadFilename) {
      const sanitizedFilename = path.basename(downloadFilename);
      const backupsDir = path.resolve(process.cwd(), 'backups');
      const targetPath = path.resolve(backupsDir, sanitizedFilename);

      if (targetPath.startsWith(backupsDir + path.sep) && fs.existsSync(targetPath)) {
        const fileBuffer = fs.readFileSync(targetPath);
        const contentType = sanitizedFilename.endsWith('.json.gz')
          ? 'application/gzip'
          : sanitizedFilename.endsWith('.json')
          ? 'application/json'
          : 'application/vnd.sqlite3';

        return new NextResponse(fileBuffer, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Content-Disposition': `attachment; filename="${sanitizedFilename}"`,
            'Content-Length': fileBuffer.byteLength.toString(),
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          },
        });
      }

      // If not on local disk, try finding in Google Drive by filename
      const backups = await getRecentBackupsAsync();
      const match = backups.find((b) => b.filename === sanitizedFilename && b.fileId);
      if (match && match.fileId) {
        const driveFile = await downloadFromGoogleDrive(match.fileId);
        const contentType = sanitizedFilename.endsWith('.json.gz')
          ? 'application/gzip'
          : sanitizedFilename.endsWith('.json')
          ? 'application/json'
          : 'application/octet-stream';

        return new NextResponse(new Uint8Array(driveFile.buffer), {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Content-Disposition': `attachment; filename="${sanitizedFilename}"`,
            'Content-Length': driveFile.buffer.length.toString(),
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          },
        });
      }

      return NextResponse.json({ error: 'Requested backup file not found.' }, { status: 404 });
    }

    const diagnostics = await getOrSetCache(
      'admin:system-health',
      30_000,
      async () => getDatabaseDiagnostics(),
      { swrMs: 60_000 }
    );

    return NextResponse.json({
      dbSizeMb: diagnostics.dbSizeMb,
      walSizeKb: diagnostics.walSizeKb,
      uploadsSizeMb: diagnostics.uploadsSizeMb,
      pingMs: diagnostics.pingMs,
      journalMode: diagnostics.journalMode,
      uptimeSeconds: diagnostics.uptimeSeconds,
      memoryMb: diagnostics.memoryMb,
      pageCount: diagnostics.pageCount,
      pageSize: diagnostics.pageSize,
      freelistCount: diagnostics.freelistCount,
      counts: diagnostics.counts,
      vault: diagnostics.vault,
      recentBackups: diagnostics.recentBackups,
      schedule: diagnostics.schedule,
      dbPath: diagnostics.dbPath,
    });
  } catch (error) {
    console.error('[System Health API] GET error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Internal server error while inspecting system health.',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/system-health
 * Executes administrative database maintenance and multi-schedule actions:
 * - action: 'BACKUP' -> creates an atomic hot snapshot (exported to Google Drive and compressed with Gzip in Cloud mode)
 * - action: 'OPTIMIZE_WAL' -> optimizes query planner and flushes WAL
 * - action: 'ADD_SCHEDULE' -> adds a new custom schedule slot
 * - action: 'TOGGLE_SCHEDULE_ITEM' -> enables/disables a specific schedule slot
 * - action: 'DELETE_SCHEDULE_ITEM' -> removes a specific schedule slot
 * - action: 'UPDATE_SCHEDULE_SETTINGS' -> updates master switch, retention count, and autoOptimizeWal
 * - action: 'DELETE_BACKUP' -> deletes a snapshot from Google Drive and disk
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedSuperadmin(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json().catch(() => ({}));
    const action = body.action;

    // Invalidate system health cache on any maintenance mutation
    invalidateCachePrefix('admin:system-health');

    // 1. MANUAL HOT BACKUP
    if (action === 'BACKUP') {
      const backup = await createHotBackup({ trigger: 'MANUAL' });

      try {
        await prisma.auditLog.create({
          data: {
            event: 'DATABASE_HOT_BACKUP_CREATED',
            userId: auth.user.id,
            resourceType: 'System',
            resourceId: backup.fileId ? 'google-drive-vault' : 'database-backup',
            details: `Manual hot backup created (${backup.filename}, ${backup.sizeFormatted}). Storage: ${
              backup.fileId ? 'Google Workspace Drive' : 'Local Disk'
            }. Duration: ${backup.durationMs || 0}ms`,
          },
        });
      } catch (auditErr) {
        console.warn('Failed to record hot backup audit log:', auditErr);
      }

      return NextResponse.json({
        success: true,
        action: 'BACKUP',
        backup,
        filename: backup.filename,
        fileSize: backup.sizeFormatted,
        sizeBytes: backup.sizeBytes,
        timestamp: backup.createdAt,
        fileId: backup.fileId,
        downloadUrl: backup.downloadUrl,
      });
    }

    // 2. WAL OPTIMIZE & TRUNCATE / CONNECTION VERIFICATION
    if (action === 'OPTIMIZE_WAL') {
      const result = await runWalOptimization();

      try {
        await prisma.auditLog.create({
          data: {
            event: 'DATABASE_WAL_OPTIMIZED',
            userId: auth.user.id,
            resourceType: 'System',
            resourceId: 'database-engine',
            details: `Database optimization executed. DB size: ${result.dbSizeMb} MB, WAL: ${result.walSizeKb} KB`,
          },
        });
      } catch (auditErr) {
        console.warn('Failed to record WAL optimization audit log:', auditErr);
      }

      return NextResponse.json({
        success: true,
        action: 'OPTIMIZE_WAL',
        walSizeKb: result.walSizeKb,
        dbSizeMb: result.dbSizeMb,
        message: result.message,
      });
    }

    // 3. ADD CUSTOM SCHEDULE SLOT
    if (action === 'ADD_SCHEDULE') {
      const itemInput = body.item;
      if (!itemInput || typeof itemInput !== 'object') {
        return NextResponse.json({ error: "Missing 'item' payload for ADD_SCHEDULE." }, { status: 400 });
      }

      const updatedConfig = await addScheduleItem(itemInput);

      try {
        await prisma.auditLog.create({
          data: {
            event: 'DATABASE_BACKUP_SCHEDULE_SLOT_ADDED',
            userId: auth.user.id,
            resourceType: 'System',
            resourceId: 'multi-schedule-manager',
            details: `New backup schedule slot added: ${itemInput.label || itemInput.timeOfDay} (${itemInput.frequency})`,
          },
        });
      } catch (auditErr) {
        console.warn('Failed to record schedule slot add audit log:', auditErr);
      }

      return NextResponse.json({
        success: true,
        action: 'ADD_SCHEDULE',
        schedule: updatedConfig,
      });
    }

    // 4. TOGGLE INDIVIDUAL SCHEDULE SLOT
    if (action === 'TOGGLE_SCHEDULE_ITEM') {
      const { id, enabled } = body;
      if (!id || typeof enabled !== 'boolean') {
        return NextResponse.json({ error: "Both 'id' and 'enabled' (boolean) are required." }, { status: 400 });
      }

      const updatedConfig = await toggleScheduleItem(id, enabled);

      try {
        await prisma.auditLog.create({
          data: {
            event: 'DATABASE_BACKUP_SCHEDULE_SLOT_TOGGLED',
            userId: auth.user.id,
            resourceType: 'System',
            resourceId: 'multi-schedule-manager',
            details: `Schedule slot '${id}' set to ${enabled ? 'ENABLED' : 'PAUSED'}`,
          },
        });
      } catch (auditErr) {
        console.warn('Failed to record toggle audit log:', auditErr);
      }

      return NextResponse.json({
        success: true,
        action: 'TOGGLE_SCHEDULE_ITEM',
        schedule: updatedConfig,
      });
    }

    // 5. DELETE INDIVIDUAL SCHEDULE SLOT
    if (action === 'DELETE_SCHEDULE_ITEM') {
      const { id } = body;
      if (!id || typeof id !== 'string') {
        return NextResponse.json({ error: "Schedule item 'id' is required." }, { status: 400 });
      }

      const updatedConfig = await deleteScheduleItem(id);

      try {
        await prisma.auditLog.create({
          data: {
            event: 'DATABASE_BACKUP_SCHEDULE_SLOT_DELETED',
            userId: auth.user.id,
            resourceType: 'System',
            resourceId: 'multi-schedule-manager',
            details: `Schedule slot '${id}' was removed.`,
          },
        });
      } catch (auditErr) {
        console.warn('Failed to record schedule deletion audit log:', auditErr);
      }

      return NextResponse.json({
        success: true,
        action: 'DELETE_SCHEDULE_ITEM',
        schedule: updatedConfig,
      });
    }

    // 6. UPDATE GLOBAL SCHEDULE SETTINGS (retention, master enable, auto-wal)
    if (action === 'UPDATE_SCHEDULE_SETTINGS') {
      const settings = body.settings || {};
      const updatedConfig = await updateScheduleSettings(settings);

      try {
        await prisma.auditLog.create({
          data: {
            event: 'DATABASE_BACKUP_SETTINGS_UPDATED',
            userId: auth.user.id,
            resourceType: 'System',
            resourceId: 'multi-schedule-manager',
            details: `Backup settings updated: Master Enabled=${updatedConfig.enabled}, Retention=${updatedConfig.retentionCount}, AutoWAL=${updatedConfig.autoOptimizeWal}`,
          },
        });
      } catch (auditErr) {
        console.warn('Failed to record schedule settings update audit log:', auditErr);
      }

      return NextResponse.json({
        success: true,
        action: 'UPDATE_SCHEDULE_SETTINGS',
        schedule: updatedConfig,
      });
    }

    // 7. DELETE BACKUP SNAPSHOT
    if (action === 'DELETE_BACKUP') {
      const { filename, fileId } = body;
      if (!filename && !fileId) {
        return NextResponse.json({ error: 'Filename or fileId is required for backup deletion.' }, { status: 400 });
      }

      try {
        await deleteBackup({ filename, fileId });

        try {
          await prisma.auditLog.create({
            data: {
              event: 'DATABASE_BACKUP_DELETED',
              userId: auth.user.id,
              resourceType: 'System',
              resourceId: fileId ? 'google-drive-vault' : 'database-backup',
              details: `Backup snapshot '${filename || fileId}' was permanently deleted.`,
            },
          });
        } catch (auditErr) {
          console.warn('Failed to record backup deletion audit log:', auditErr);
        }

        const recentBackups = await getRecentBackupsAsync();
        return NextResponse.json({
          success: true,
          action: 'DELETE_BACKUP',
          filename,
          fileId,
          recentBackups,
        });
      } catch (delErr: any) {
        return NextResponse.json({ error: delErr.message || 'Failed to delete backup file.' }, { status: 400 });
      }
    }

    // 8. BACKWARDS COMPATIBILITY: UPDATE_SCHEDULE
    if (action === 'UPDATE_SCHEDULE') {
      const scheduleUpdates = (body.schedule || {}) as Partial<BackupScheduleConfig>;
      const current = await loadBackupScheduleAsync();
      const updated: BackupScheduleConfig = {
        ...current,
        ...scheduleUpdates,
      };
      await saveBackupScheduleAsync(updated);
      return NextResponse.json({
        success: true,
        action: 'UPDATE_SCHEDULE',
        schedule: updated,
      });
    }

    return NextResponse.json(
      {
        error:
          "Invalid action. Supported actions: 'BACKUP', 'OPTIMIZE_WAL', 'ADD_SCHEDULE', 'TOGGLE_SCHEDULE_ITEM', 'DELETE_SCHEDULE_ITEM', 'UPDATE_SCHEDULE_SETTINGS', 'DELETE_BACKUP'.",
      },
      { status: 400 }
    );
  } catch (error) {
    console.error('[System Health API] POST error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Internal server error while executing database maintenance.',
      },
      { status: 500 }
    );
  }
}
