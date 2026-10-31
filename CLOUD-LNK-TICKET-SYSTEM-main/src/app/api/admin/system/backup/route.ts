import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { prisma, resolveDatabaseFilePath } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';

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
      error: 'Forbidden: Superadmin clearance required to download database backups.',
      status: 403,
    };
  }

  return { user: sessionData.user };
}

/**
 * GET /api/admin/system/backup
 * Performs a WAL checkpoint (TRUNCATE) and streams a safe, immutable SQLite binary snapshot.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedSuperadmin(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const dbUrl = process.env.DATABASE_URL || '';
    const isPostgres = dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://');

    if (isPostgres) {
      const { createHotBackup } = await import('@/lib/sqlite-maintenance');
      const backupInfo = await createHotBackup({ trigger: 'MANUAL' });
      const fileBuffer = fs.readFileSync(backupInfo.filepath);

      return new NextResponse(fileBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="${backupInfo.filename}"`,
          'Content-Length': fileBuffer.byteLength.toString(),
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      });
    }

    const dbPath = resolveDatabaseFilePath();
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json(
        { error: `Database file not found at path: ${dbPath}` },
        { status: 500 }
      );
    }

    // Execute SQLite WAL checkpoint (TRUNCATE) to flush all pending WAL logs into main database file
    // Note: In SQLite, PRAGMAs return a result row, so $queryRawUnsafe is required
    await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);');

    // Read freshly checkpointed database binary
    const fileBuffer = fs.readFileSync(dbPath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `ticket-system-backup-${timestamp}.sqlite`;

    // Record audit log
    try {
      await prisma.auditLog.create({
        data: {
          event: 'DATABASE_BACKUP_DOWNLOADED',
          userId: auth.user.id,
          resourceType: 'System',
          resourceId: 'sqlite',
          details: `SQLite database snapshot downloaded (${(fileBuffer.byteLength / 1024).toFixed(1)} KB, file: ${filename})`,
        },
      });
    } catch (auditErr) {
      console.error('Failed to write audit log for backup:', auditErr);
    }

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.sqlite3',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': fileBuffer.byteLength.toString(),
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error) {
    console.error('SQLite backup generation error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Internal server error while generating database backup.',
      },
      { status: 500 }
    );
  }
}
