import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { checkRateLimit } from '@/lib/security/rate-limit';

const MAX_EXPORT_LIMIT = 10000;

interface ExportFilterPayload {
  scope: 'ALL_SYSTEM' | 'DEPARTMENT';
  spaceId?: string;
  listId?: string;
  statusId?: string;
  format: 'json' | 'csv';
  includeHistory?: boolean;
  includeComments?: boolean;
}

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
      error: 'Forbidden: Superadmin clearance required to export system data.',
      status: 403,
    };
  }

  return { user: sessionData.user };
}

function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedSuperadmin(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user } = auth;

    // Rate limiting: max 10 export requests per 5 minutes per superadmin
    const rateLimit = checkRateLimit(`data-export:${user.id}`, { maxRequests: 10, windowMs: 5 * 60 * 1000 });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'TOO_MANY_REQUESTS', message: 'Too many data export requests. Please wait.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
      );
    }

    let payload: ExportFilterPayload;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'INVALID_REQUEST', message: 'Request body must be valid JSON.' },
        { status: 400 }
      );
    }

    const {
      scope = 'ALL_SYSTEM',
      spaceId,
      listId,
      statusId,
      format = 'json',
      includeHistory = true,
      includeComments = true,
    } = payload;

    if (scope === 'DEPARTMENT' && !spaceId) {
      return NextResponse.json(
        { error: 'INVALID_REQUEST', message: 'spaceId is required when scope is DEPARTMENT.' },
        { status: 400 }
      );
    }

    // Dynamic Prisma query assembly
    const where: Prisma.TaskWhereInput = {};

    if (scope === 'DEPARTMENT' && spaceId) {
      where.spaceId = spaceId;
      if (listId && listId !== 'ALL') {
        where.listId = listId;
      }
      if (statusId && statusId !== 'ALL') {
        where.statusId = statusId;
      }
    } else if (scope === 'ALL_SYSTEM') {
      if (listId && listId !== 'ALL') {
        where.listId = listId;
      }
      if (statusId && statusId !== 'ALL') {
        where.statusId = statusId;
      }
    }

    // Query tasks with associated relations (capped at MAX_EXPORT_LIMIT to prevent OOM)
    const tasks = await prisma.task.findMany({
      where,
      take: MAX_EXPORT_LIMIT,
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: {
          select: { id: true, username: true, name: true, email: true },
        },
        assignee: {
          select: { id: true, username: true, name: true, email: true },
        },
        space: {
          select: { id: true, name: true, slug: true, key: true },
        },
        list: {
          select: { id: true, name: true, color: true, isPrivate: true, order: true },
        },
        status: {
          select: { id: true, name: true, color: true, isCompleted: true, isClosed: true, order: true },
        },
        comments: includeComments
          ? {
              orderBy: { createdAt: 'asc' },
              include: {
                author: { select: { id: true, username: true, name: true, email: true } },
              },
            }
          : false,
        history: includeHistory
          ? {
              orderBy: { createdAt: 'asc' },
              include: {
                actor: { select: { id: true, username: true, name: true, email: true } },
                fromSpace: { select: { id: true, name: true, key: true } },
                toSpace: { select: { id: true, name: true, key: true } },
              },
            }
          : false,
      },
    });

    const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');

    if (format === 'csv') {
      // Flatten ticket records into columns:
      // Key, Title, Department, Queue, Status, Priority, Assignee, Reporter, CreatedAt, ClosedAt
      const headers = [
        'Key',
        'Title',
        'Department',
        'Queue',
        'Status',
        'Priority',
        'Assignee',
        'Reporter',
        'CreatedAt',
        'ClosedAt',
      ];

      const rows = tasks.map((t) => {
        let closedAt = '';
        if (t.status?.isClosed) {
          if (Array.isArray(t.history)) {
            const closedHistory = [...t.history].reverse().find((h) => h.actionType === 'CLOSED');
            if (closedHistory) {
              closedAt = new Date(closedHistory.createdAt).toISOString();
            }
          }
          if (!closedAt && t.updatedAt) {
            closedAt = new Date(t.updatedAt).toISOString();
          }
        }

        return [
          escapeCsv(t.taskKey),
          escapeCsv(t.title),
          escapeCsv(t.space?.name || ''),
          escapeCsv(t.list?.name || ''),
          escapeCsv(t.status?.name || ''),
          escapeCsv(t.priority),
          escapeCsv(t.assignee?.name || t.assignee?.username || ''),
          escapeCsv(t.createdBy?.name || t.createdBy?.username || ''),
          escapeCsv(t.createdAt ? new Date(t.createdAt).toISOString() : ''),
          escapeCsv(closedAt),
        ].join(',');
      });

      const csvContent = [headers.join(','), ...rows].join('\r\n');
      const filename = `tickets-export-${scope.toLowerCase()}-${timestampStr}.csv`;

      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    // Default: JSON export format with metadata header
    const exportResponse = {
      metadata: {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        exportedBy: {
          id: user.id,
          username: user.username,
          name: user.name,
        },
        filterCriteria: {
          scope,
          spaceId: spaceId || null,
          listId: listId || null,
          statusId: statusId || null,
          includeHistory: Boolean(includeHistory),
          includeComments: Boolean(includeComments),
        },
        recordCount: tasks.length,
      },
      data: tasks,
    };

    const filename = `tickets-export-${scope.toLowerCase()}-${timestampStr}.json`;

    return new NextResponse(JSON.stringify(exportResponse, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Data Export Error:', error);
    return NextResponse.json(
      {
        error: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Internal error exporting data',
      },
      { status: 500 }
    );
  }
}
