import { NextRequest, NextResponse } from 'next/server';
import { executeScheduledBackupsIfDue, loadBackupScheduleAsync } from '@/lib/sqlite-maintenance';

function isAuthorized(request: NextRequest): boolean {
  const expectedToken = (process.env.CRON_SECRET || process.env.GOOGLE_DRIVE_BRIDGE_TOKEN || 'lk-drive-bridge-secret-2026').trim();

  // 1. Query parameter token
  const queryToken = request.nextUrl.searchParams.get('token');
  if (queryToken && queryToken.trim() === expectedToken) {
    return true;
  }

  // 2. Authorization header (Bearer <token>)
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.substring(7).trim();
    if (bearer === expectedToken) {
      return true;
    }
  }

  // 3. Custom Header x-cron-secret
  const headerSecret = request.headers.get('x-cron-secret');
  if (headerSecret && headerSecret.trim() === expectedToken) {
    return true;
  }

  return false;
}

async function handleCron(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: 'Unauthorized: Invalid cron webhook secret token.' },
      { status: 401 }
    );
  }

  const force = request.nextUrl.searchParams.get('force') === 'true';

  try {
    const { executedCount, results } = await executeScheduledBackupsIfDue(force);
    const schedule = await loadBackupScheduleAsync();

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      forced: force,
      executedCount,
      results,
      nextScheduledRun: schedule.nextRunAt,
      scheduleEnabled: schedule.enabled,
    });
  } catch (error: any) {
    console.error('[Cron Webhook] Backup execution error:', error);
    return NextResponse.json(
      {
        error: error.message || 'Internal error while executing automated backup cron.',
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handleCron(request);
}

export async function POST(request: NextRequest) {
  return handleCron(request);
}
