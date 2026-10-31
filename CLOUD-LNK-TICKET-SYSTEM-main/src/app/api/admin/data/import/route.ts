import { NextRequest, NextResponse } from 'next/server';
import { Priority } from '@prisma/client';
import { prisma, withDbRetry } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { checkRateLimit } from '@/lib/security/rate-limit';

const MAX_IMPORT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB ceiling
const MAX_TASKS_PER_IMPORT = 1000; // Cap to prevent SQLite WAL locking and memory exhaustion

interface ImportOptions {
  targetSpaceId?: string;
  targetListId?: string;
  duplicateStrategy?: 'SKIP' | 'GENERATE_NEW_KEY' | 'OVERWRITE';
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
      error: 'Forbidden: Superadmin clearance required to import system data.',
      status: 403,
    };
  }

  return { user: sessionData.user };
}

function parseCsvContent(csvText: string): Record<string, string>[] {
  const lines: string[] = [];
  let currentLine = '';
  let insideQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentLine += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if ((char === '\n' || char === '\r') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      if (currentLine.trim().length > 0) {
        lines.push(currentLine);
      }
      currentLine = '';
    } else {
      currentLine += char;
    }
  }
  if (currentLine.trim().length > 0) {
    lines.push(currentLine);
  }

  if (lines.length < 2) return [];

  const parseRow = (line: string): string[] => {
    const entries: string[] = [];
    let entry = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      const nc = line[i + 1];
      if (c === '"') {
        if (inQ && nc === '"') {
          entry += '"';
          i++;
        } else {
          inQ = !inQ;
        }
      } else if (c === ',' && !inQ) {
        entries.push(entry.trim());
        entry = '';
      } else {
        entry += c;
      }
    }
    entries.push(entry.trim());
    return entries;
  };

  const headers = parseRow(lines[0]).map((h) => h.trim());
  const records: Record<string, string>[] = [];

  for (let r = 1; r < lines.length; r++) {
    const rowValues = parseRow(lines[r]);
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = rowValues[idx] !== undefined ? rowValues[idx] : '';
    });
    records.push(obj);
  }

  return records;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedSuperadmin(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user } = auth;

    // Rate limiting: max 5 imports per 10 minutes per superadmin
    const rateLimit = checkRateLimit(`data-import:${user.id}`, { maxRequests: 5, windowMs: 10 * 60 * 1000 });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'TOO_MANY_REQUESTS', message: 'Too many data import attempts. Please wait.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
      );
    }

    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_IMPORT_SIZE_BYTES) {
      return NextResponse.json(
        { error: 'PAYLOAD_TOO_LARGE', message: 'Request payload exceeds 10MB limit.' },
        { status: 413 }
      );
    }

    const contentType = request.headers.get('content-type') || '';

    let rawTasks: any[] = [];
    let targetSpaceId: string | undefined;
    let targetListId: string | undefined;
    let duplicateStrategy: 'SKIP' | 'GENERATE_NEW_KEY' | 'OVERWRITE' = 'SKIP';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      targetSpaceId = formData.get('targetSpaceId')?.toString() || undefined;
      targetListId = formData.get('targetListId')?.toString() || undefined;
      const strat = formData.get('duplicateStrategy')?.toString();
      if (strat === 'SKIP' || strat === 'GENERATE_NEW_KEY' || strat === 'OVERWRITE') {
        duplicateStrategy = strat;
      }

      if (!file) {
        return NextResponse.json(
          { error: 'INVALID_REQUEST', message: 'No file provided in form data.' },
          { status: 400 }
        );
      }

      if (file.size > MAX_IMPORT_SIZE_BYTES) {
        return NextResponse.json(
          { error: 'PAYLOAD_TOO_LARGE', message: 'Uploaded import file exceeds 10MB limit.' },
          { status: 413 }
        );
      }

      const fileText = await file.text();
      const fileName = file.name.toLowerCase();

      if (fileName.endsWith('.csv')) {
        const csvRecords = parseCsvContent(fileText);
        rawTasks = csvRecords.map((r) => ({
          taskKey: r.Key || r.taskKey || r['Ticket Key'] || '',
          title: r.Title || r.title || 'Imported Ticket',
          department: r.Department || r.department || '',
          queue: r.Queue || r.queue || '',
          status: r.Status || r.status || '',
          priority: r.Priority || r.priority || 'NORMAL',
          assignee: r.Assignee || r.assignee || '',
          reporter: r.Reporter || r.reporter || '',
          createdAt: r.CreatedAt || r.createdAt || '',
        }));
      } else {
        // Assume JSON
        try {
          const parsed = JSON.parse(fileText);
          if (Array.isArray(parsed)) {
            rawTasks = parsed;
          } else if (Array.isArray(parsed.data)) {
            rawTasks = parsed.data;
          } else if (Array.isArray(parsed.tasks)) {
            rawTasks = parsed.tasks;
          } else {
            return NextResponse.json(
              { error: 'INVALID_FORMAT', message: 'JSON format does not contain a valid task array.' },
              { status: 400 }
            );
          }
        } catch {
          return NextResponse.json(
            { error: 'PARSE_ERROR', message: 'Failed to parse JSON file content.' },
            { status: 400 }
          );
        }
      }
    } else {
      // JSON body
      let body: any;
      try {
        body = await request.json();
      } catch {
        return NextResponse.json(
          { error: 'INVALID_REQUEST', message: 'Invalid JSON request body.' },
          { status: 400 }
        );
      }

      targetSpaceId = body.targetSpaceId || undefined;
      targetListId = body.targetListId || undefined;
      if (body.duplicateStrategy === 'SKIP' || body.duplicateStrategy === 'GENERATE_NEW_KEY' || body.duplicateStrategy === 'OVERWRITE') {
        duplicateStrategy = body.duplicateStrategy;
      }

      if (Array.isArray(body.tasks)) {
        rawTasks = body.tasks;
      } else if (typeof body.fileContent === 'string') {
        const fileContent = body.fileContent;
        const fileType = body.fileType || (fileContent.trim().startsWith('{') || fileContent.trim().startsWith('[') ? 'json' : 'csv');

        if (fileType === 'csv') {
          const csvRecords = parseCsvContent(fileContent);
          rawTasks = csvRecords.map((r) => ({
            taskKey: r.Key || r.taskKey || r['Ticket Key'] || '',
            title: r.Title || r.title || 'Imported Ticket',
            department: r.Department || r.department || '',
            queue: r.Queue || r.queue || '',
            status: r.Status || r.status || '',
            priority: r.Priority || r.priority || 'NORMAL',
            assignee: r.Assignee || r.assignee || '',
            reporter: r.Reporter || r.reporter || '',
            createdAt: r.CreatedAt || r.createdAt || '',
          }));
        } else {
          try {
            const parsed = JSON.parse(fileContent);
            if (Array.isArray(parsed)) {
              rawTasks = parsed;
            } else if (Array.isArray(parsed.data)) {
              rawTasks = parsed.data;
            } else if (Array.isArray(parsed.tasks)) {
              rawTasks = parsed.tasks;
            } else {
              rawTasks = [];
            }
          } catch {
            return NextResponse.json(
              { error: 'Failed to parse JSON fileContent.', code: 'PARSE_ERROR' },
              { status: 400 }
            );
          }
        }
      } else {
        return NextResponse.json(
          { error: 'Either tasks array or fileContent must be provided.', code: 'INVALID_REQUEST' },
          { status: 400 }
        );
      }
    }

    if (rawTasks.length === 0) {
      return NextResponse.json(
        { error: 'No ticket records found to import.', code: 'EMPTY_DATASET' },
        { status: 400 }
      );
    }

    if (rawTasks.length > MAX_TASKS_PER_IMPORT) {
      return NextResponse.json(
        {
          error: `Batch contains ${rawTasks.length} tickets, exceeding the maximum limit of ${MAX_TASKS_PER_IMPORT} tickets per batch import.`,
          code: 'PAYLOAD_TOO_LARGE',
        },
        { status: 400 }
      );
    }

    // Load reference data from DB
    const [allSpaces, allUsers] = await Promise.all([
      prisma.space.findMany({
        include: {
          lists: { orderBy: { order: 'asc' } },
          statuses: { orderBy: { order: 'asc' } },
        },
      }),
      prisma.user.findMany({
        select: { id: true, username: true, email: true, name: true },
      }),
    ]);

    if (allSpaces.length === 0) {
      return NextResponse.json(
        { error: 'No department spaces exist in the system to import tickets into.', code: 'NO_SPACES' },
        { status: 400 }
      );
    }

    // Map existing tasks for key collision detection
    const existingTasks = await prisma.task.findMany({
      select: { id: true, taskKey: true, spaceId: true },
    });
    const existingKeyMap = new Map<string, { id: string; spaceId: string }>();
    existingTasks.forEach((t) => existingKeyMap.set(t.taskKey.toUpperCase(), { id: t.id, spaceId: t.spaceId }));

    // Compute next sequential counter per space key
    const spaceKeyCounters = new Map<string, number>();
    for (const sp of allSpaces) {
      let maxNum = 100;
      existingTasks
        .filter((t) => t.spaceId === sp.id)
        .forEach((t) => {
          const match = t.taskKey.match(/-(\d+)$/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (!isNaN(num) && num > maxNum) maxNum = num;
          }
        });
      spaceKeyCounters.set(sp.id, maxNum + 1);
    }

    const errors: string[] = [];
    let importedCount = 0;
    let skippedCount = 0;

    // Execute import in batched transactions of 20 with explicit transaction timeout
    const BATCH_SIZE = 20;
    for (let chunkStart = 0; chunkStart < rawTasks.length; chunkStart += BATCH_SIZE) {
      const chunk = rawTasks.slice(chunkStart, chunkStart + BATCH_SIZE);
      await withDbRetry(() =>
        prisma.$transaction(async (tx) => {
          for (let i = 0; i < chunk.length; i++) {
            const raw = chunk[i];
            const rowIndex = chunkStart + i;
            try {
          // 1. Resolve Target Space
          let space = targetSpaceId ? allSpaces.find((s) => s.id === targetSpaceId) : null;
          if (!space && raw.spaceId) {
            space = allSpaces.find((s) => s.id === raw.spaceId) || null;
          }
          if (!space) {
            const deptIdentifier = (raw.space?.key || raw.space?.name || raw.department || '').toLowerCase().trim();
            if (deptIdentifier) {
              space =
                allSpaces.find(
                  (s) =>
                    s.key.toLowerCase() === deptIdentifier ||
                    s.name.toLowerCase() === deptIdentifier ||
                    s.slug.toLowerCase() === deptIdentifier
                ) || null;
            }
          }
          if (!space) {
            space = allSpaces[0];
          }

          // 2. Resolve Target List / Queue
          let list = targetListId ? space.lists.find((l) => l.id === targetListId) : null;
          if (!list && raw.listId) {
            list = space.lists.find((l) => l.id === raw.listId) || null;
          }
          if (!list) {
            const queueName = (raw.list?.name || raw.queue || '').toLowerCase().trim();
            if (queueName) {
              list = space.lists.find((l) => l.name.toLowerCase() === queueName) || null;
            }
          }
          if (!list) {
            if (space.lists.length > 0) {
              list = space.lists[0];
            } else {
              // Create default queue list if none exists in this space
              list = await tx.list.create({
                data: {
                  spaceId: space.id,
                  name: 'General Queue',
                  order: 0,
                  isPrivate: false,
                },
              });
              space.lists.push(list);
            }
          }

          // 3. Resolve Target Status
          let status = raw.statusId ? space.statuses.find((s) => s.id === raw.statusId) : null;
          if (!status) {
            const statusName = (raw.status?.name || raw.status || '').toLowerCase().trim();
            if (statusName) {
              status = space.statuses.find((s) => s.name.toLowerCase() === statusName) || null;
            }
          }
          if (!status) {
            // Pick default initial status (non-closed lowest order, or first status)
            const initialStatus = space.statuses.find((s) => !s.isClosed) || space.statuses[0];
            if (initialStatus) {
              status = initialStatus;
            } else {
              // Create default status if none exists
              status = await tx.taskStatus.create({
                data: {
                  spaceId: space.id,
                  name: 'OPEN',
                  color: '#3B82F6',
                  order: 0,
                  isCompleted: false,
                  isClosed: false,
                },
              });
              space.statuses.push(status);
            }
          }

          // 4. Resolve Creator (Reporter)
          let creatorId = user.id;
          if (raw.createdById && allUsers.some((u) => u.id === raw.createdById)) {
            creatorId = raw.createdById;
          } else {
            const reporterIdentifier = (raw.createdBy?.username || raw.createdBy?.email || raw.reporter || '')
              .toLowerCase()
              .trim();
            if (reporterIdentifier) {
              const matchedUser = allUsers.find(
                (u) =>
                  u.username.toLowerCase() === reporterIdentifier ||
                  u.email.toLowerCase() === reporterIdentifier ||
                  u.name.toLowerCase() === reporterIdentifier
              );
              if (matchedUser) {
                creatorId = matchedUser.id;
              }
            }
          }

          // 5. Resolve Assignee
          let assigneeId: string | null = null;
          if (raw.assigneeId && allUsers.some((u) => u.id === raw.assigneeId)) {
            assigneeId = raw.assigneeId;
          } else {
            const assigneeIdentifier = (raw.assignee?.username || raw.assignee?.email || raw.assignee || '')
              .toLowerCase()
              .trim();
            if (assigneeIdentifier) {
              const matchedUser = allUsers.find(
                (u) =>
                  u.username.toLowerCase() === assigneeIdentifier ||
                  u.email.toLowerCase() === assigneeIdentifier ||
                  u.name.toLowerCase() === assigneeIdentifier
              );
              if (matchedUser) {
                assigneeId = matchedUser.id;
              }
            }
          }

          // 6. Resolve Priority
          const rawPriority = String(raw.priority || '').toUpperCase();
          const priority: Priority = ['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(rawPriority)
            ? (rawPriority as Priority)
            : Priority.NORMAL;

          // 7. Resolve Custom Fields & Timestamps
          let customFields = '{}';
          if (raw.customFields) {
            customFields = typeof raw.customFields === 'string' ? raw.customFields : JSON.stringify(raw.customFields);
          }

          const title = String(raw.title || 'Untitled Ticket').trim();
          const description = raw.description ? String(raw.description) : null;

          // 8. Key Collision Detection & Duplicate Handling
          const candidateKey = String(raw.taskKey || '').trim().toUpperCase();
          const existingRecord = candidateKey ? existingKeyMap.get(candidateKey) : null;

          if (existingRecord) {
            if (duplicateStrategy === 'SKIP') {
              skippedCount++;
              continue;
            } else if (duplicateStrategy === 'OVERWRITE') {
              await tx.task.update({
                where: { id: existingRecord.id },
                data: {
                  title,
                  description,
                  priority,
                  statusId: status.id,
                  listId: list.id,
                  customFields,
                  assigneeId,
                },
              });
              importedCount++;
              continue;
            }
            // If duplicateStrategy === 'GENERATE_NEW_KEY', proceed to generate a brand new key below
          }

          // Generate or assign key
          let finalKey: string;
          if (duplicateStrategy === 'GENERATE_NEW_KEY' || !candidateKey || existingRecord) {
            let nextCounter = spaceKeyCounters.get(space.id) || 101;
            finalKey = `${space.key}-${nextCounter}`;
            while (existingKeyMap.has(finalKey.toUpperCase())) {
              nextCounter++;
              finalKey = `${space.key}-${nextCounter}`;
            }
            spaceKeyCounters.set(space.id, nextCounter + 1);
          } else {
            finalKey = candidateKey;
          }

          // Create the Task
          const createdTask = await tx.task.create({
            data: {
              taskKey: finalKey,
              title,
              description,
              priority,
              statusId: status.id,
              listId: list.id,
              spaceId: space.id,
              createdById: creatorId,
              assigneeId,
              customFields,
            },
          });

          existingKeyMap.set(finalKey.toUpperCase(), { id: createdTask.id, spaceId: space.id });
          importedCount++;

          // Import Comments if present
          if (Array.isArray(raw.comments) && raw.comments.length > 0) {
            for (const c of raw.comments) {
              if (c.content) {
                let commentAuthorId = user.id;
                if (c.authorId && allUsers.some((u) => u.id === c.authorId)) {
                  commentAuthorId = c.authorId;
                } else if (c.author?.username) {
                  const authorMatch = allUsers.find((u) => u.username === c.author.username);
                  if (authorMatch) commentAuthorId = authorMatch.id;
                }

                await tx.taskComment.create({
                  data: {
                    taskId: createdTask.id,
                    authorId: commentAuthorId,
                    content: String(c.content),
                    isInternal: Boolean(c.isInternal),
                  },
                });
              }
            }
          }

          // Import History if present
          if (Array.isArray(raw.history) && raw.history.length > 0) {
            for (const h of raw.history) {
              if (h.actionType) {
                let historyActorId = user.id;
                if (h.actorId && allUsers.some((u) => u.id === h.actorId)) {
                  historyActorId = h.actorId;
                } else if (h.actor?.username) {
                  const actorMatch = allUsers.find((u) => u.username === h.actor.username);
                  if (actorMatch) historyActorId = actorMatch.id;
                }

                await tx.taskHistory.create({
                  data: {
                    taskId: createdTask.id,
                    actorId: historyActorId,
                    actionType: String(h.actionType),
                    fromSpaceId: h.fromSpaceId || null,
                    toSpaceId: h.toSpaceId || null,
                    fromQueueName: h.fromQueueName || null,
                    toQueueName: h.toQueueName || null,
                    notes: h.notes ? String(h.notes) : null,
                  },
                });
              }
            }
          }
        } catch (taskErr) {
          const errMsg = `Row ${rowIndex + 1} (${raw.taskKey || raw.title || 'Unknown'}): ${
            taskErr instanceof Error ? taskErr.message : 'Unknown error'
          }`;
          errors.push(errMsg);
        }
      }
    }, { maxWait: 20000, timeout: 60000 }));
  }

    return NextResponse.json({
      success: true,
      importedCount,
      skippedCount,
      totalProcessed: rawTasks.length,
      errors,
    });
  } catch (error) {
    console.error('Data Import Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal error processing import dataset',
        code: 'INTERNAL_ERROR',
      },
      { status: 500 }
    );
  }
}
