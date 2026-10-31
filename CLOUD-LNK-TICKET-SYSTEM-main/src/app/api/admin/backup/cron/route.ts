import { NextRequest, NextResponse } from 'next/server';
import { createHotBackup, loadBackupScheduleAsync } from '@/lib/sqlite-maintenance';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Up to 60s for Vercel Hobby serverless execution

function isAuthorized(request: NextRequest): boolean {
  const expectedToken = (
    process.env.CRON_SECRET ||
    process.env.GOOGLE_DRIVE_BRIDGE_TOKEN ||
    'lk-drive-bridge-secret-2026'
  ).trim();

  // 1. Authorization header: Bearer <CRON_SECRET> (Standard Vercel Cron authentication)
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.substring(7).trim();
    if (bearer === expectedToken) {
      return true;
    }
  }

  // 2. Query param: ?token=<CRON_SECRET>
  const queryToken = request.nextUrl.searchParams.get('token');
  if (queryToken && queryToken.trim() === expectedToken) {
    return true;
  }

  // 3. Custom Header: x-cron-secret
  const headerSecret = request.headers.get('x-cron-secret');
  if (headerSecret && headerSecret.trim() === expectedToken) {
    return true;
  }

  return false;
}

/**
 * GET /api/admin/backup/cron
 * Automated Cloud Backup Cron Endpoint for Vercel Cron.
 * Secured via CRON_SECRET Bearer token.
 * Generates an atomic hot backup (.json.gz) and streams it to Google Drive Backups folder.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: 'Unauthorized: Invalid or missing CRON_SECRET.' },
      { status: 401 }
    );
  }

  const startTime = Date.now();

  try {
    console.log('[Automated Backup Cron] Starting scheduled hot backup pipeline...');
    const backupInfo = await createHotBackup({ trigger: 'SCHEDULED' });
    const durationMs = Date.now() - startTime;
    const schedule = await loadBackupScheduleAsync().catch(() => null);

    console.log(
      `[Automated Backup Cron] Completed successfully in ${durationMs}ms: ${backupInfo.filename} (${backupInfo.sizeFormatted})`
    );

    return NextResponse.json({
      success: true,
      trigger: 'SCHEDULED',
      durationMs,
      backup: {
        fileId: backupInfo.fileId,
        filename: backupInfo.filename,
        sizeBytes: backupInfo.sizeBytes,
        sizeFormatted: backupInfo.sizeFormatted,
        createdAt: backupInfo.createdAt,
        downloadUrl: backupInfo.downloadUrl,
      },
      nextRunAt: schedule?.nextRunAt ?? null,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    console.error('[Automated Backup Cron] Hot backup failed:', error);

    return NextResponse.json(
      {
        success: false,
        trigger: 'SCHEDULED',
        durationMs,
        error: error.message || 'Internal error while executing automated backup cron.',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
