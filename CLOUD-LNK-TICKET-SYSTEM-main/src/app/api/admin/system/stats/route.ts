import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import { prisma, getDatabasePragmas, resolveDatabaseFilePath } from '@/lib/db';
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
      error: 'Forbidden: Superadmin clearance required to view system telemetry.',
      status: 403,
    };
  }

  return { user: sessionData.user };
}

/**
 * GET /api/admin/system/stats
 * Telemetry endpoint for database metrics, file size, counts, and pragmas.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedSuperadmin(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const dbUrl = process.env.DATABASE_URL || '';
    const isPostgres = dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://');
    const dbPath = resolveDatabaseFilePath();
    let dbSizeBytes = 0;
    let walSizeBytes = 0;
    let shmSizeBytes = 0;

    if (!isPostgres) {
      if (fs.existsSync(dbPath)) {
        dbSizeBytes = fs.statSync(dbPath).size;
      }
      const walPath = `${dbPath}-wal`;
      if (fs.existsSync(walPath)) {
        walSizeBytes = fs.statSync(walPath).size;
      }
      const shmPath = `${dbPath}-shm`;
      if (fs.existsSync(shmPath)) {
        shmSizeBytes = fs.statSync(shmPath).size;
      }
    } else {
      try {
        const sizeRes = await prisma.$queryRawUnsafe<Array<{ size_bytes: string | number | bigint }>>(
          'SELECT pg_database_size(current_database())::bigint AS size_bytes;'
        );
        if (sizeRes && sizeRes[0]?.size_bytes != null) {
          dbSizeBytes = Number(sizeRes[0].size_bytes);
        }
      } catch (err) {
        console.warn('Postgres stats query notice:', err);
      }
    }

    const totalSizeBytes = dbSizeBytes + walSizeBytes + shmSizeBytes;

    const [ticketCount, userCount, auditLogCount, spaceCount, pragmas, lastBackupLog] =
      await Promise.all([
        prisma.task.count(),
        prisma.user.count(),
        prisma.auditLog.count(),
        prisma.space.count(),
        getDatabasePragmas().catch(() => ({
          journalMode: 'wal',
          busyTimeout: 5000,
          foreignKeys: true,
        })),
        prisma.auditLog.findFirst({
          where: { event: 'DATABASE_BACKUP_DOWNLOADED' },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, details: true },
        }),
      ]);

    const formattedSize =
      totalSizeBytes >= 1024 * 1024
        ? `${(totalSizeBytes / (1024 * 1024)).toFixed(2)} MB`
        : `${(totalSizeBytes / 1024).toFixed(1)} KB`;

    return NextResponse.json({
      dbPath,
      diskUsage: {
        totalBytes: totalSizeBytes,
        dbBytes: dbSizeBytes,
        walBytes: walSizeBytes,
        shmBytes: shmSizeBytes,
        formatted: formattedSize,
      },
      counts: {
        tickets: ticketCount,
        users: userCount,
        auditLogs: auditLogCount,
        spaces: spaceCount,
      },
      sqlite: {
        journalMode: pragmas.journalMode.toUpperCase(),
        walActive: pragmas.journalMode.toLowerCase() === 'wal',
        busyTimeout: pragmas.busyTimeout,
        foreignKeys: pragmas.foreignKeys,
      },
      lastBackup: lastBackupLog?.createdAt || null,
      lastBackupDetails: lastBackupLog?.details || null,
    });
  } catch (error) {
    console.error('System stats error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Internal server error while fetching system telemetry.',
      },
      { status: 500 }
    );
  }
}
