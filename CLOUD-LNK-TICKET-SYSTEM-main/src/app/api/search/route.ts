import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { getUserAssignedSpaceIds } from '@/lib/security/rbac';

async function getAuthenticatedUser(request: NextRequest) {
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

  return { user: sessionData.user };
}

function extractSpaceColor(desc?: string | null): string {
  if (!desc) return '#3B82F6';
  try {
    const parsed = JSON.parse(desc);
    return parsed.color || '#3B82F6';
  } catch {
    return '#3B82F6';
  }
}

function createSnippet(content: string, query: string, maxLength = 120): string {
  if (!content) return '';
  const idx = content.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) {
    return content.length > maxLength ? content.slice(0, maxLength) + '...' : content;
  }
  const start = Math.max(0, idx - 35);
  const end = Math.min(content.length, idx + query.length + 55);
  let snippet = content.slice(start, end).trim();
  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet = snippet + '...';
  return snippet;
}

/**
 * GET /api/search?q=<query>&limit=20
 * Strict Permission-Aware Global Search & Command Palette Endpoint
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user } = auth;
    const { searchParams } = request.nextUrl;
    const rawQuery = searchParams.get('q')?.trim() || '';
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10), 1), 50);

    // If query is empty or less than 2 characters, return empty categorized arrays immediately
    if (rawQuery.length < 2) {
      return NextResponse.json({
        query: rawQuery,
        tickets: [],
        spaces: [],
        comments: [],
        totalCount: 0,
      });
    }

    // Filter prefixes support:
    // If query starts with '#' (space/queue search) or '@' (author/assignee)
    let cleanQuery = rawQuery;
    let prioritizeType: 'all' | 'spaces' | 'people' = 'all';
    if (rawQuery.startsWith('#')) {
      prioritizeType = 'spaces';
      cleanQuery = rawQuery.slice(1).trim();
    } else if (rawQuery.startsWith('@')) {
      prioritizeType = 'people';
      cleanQuery = rawQuery.slice(1).trim();
    }

    if (cleanQuery.length === 0) {
      cleanQuery = rawQuery;
      prioritizeType = 'all';
    }

    const isSuperadmin = user.globalRole === 'SUPERADMIN';
    const authorizedSpaceIds = isSuperadmin ? [] : await getUserAssignedSpaceIds(user.id, prisma);

    // 1. Build Allowed Ticket Scope (Strict RBAC Zero-Data Leakage)
    // Admin & Employee users assigned to the same space share 100% identical visibility:
    // - Own Department Spaces: task.spaceId IN authorizedSpaceIds
    // - Active cross-department collaborations:
    //   - task.createdById === currentUser.id OR createdBy from department staff (non-superadmin)
    //   - task.assigneeId === currentUser.id
    //   - task.history contains record where fromSpaceId IN authorizedSpaceIds OR toSpaceId IN authorizedSpaceIds
    //   - task.comments contains comment authored by currentUser.id OR department staff
    const departmentStaffFilter: Prisma.UserWhereInput = {
      globalRole: { not: 'SUPERADMIN' },
      OR: [
        { spaceMemberships: { some: { spaceId: { in: authorizedSpaceIds } } } },
        { headedSpaces: { some: { id: { in: authorizedSpaceIds } } } },
      ],
    };

    const allowedTicketScope: Prisma.TaskWhereInput = isSuperadmin
      ? {}
      : {
          OR: [
            { spaceId: { in: authorizedSpaceIds } },
            { createdById: user.id },
            { createdBy: departmentStaffFilter },
            { assigneeId: user.id },
            {
              history: {
                some: {
                  OR: [
                    { fromSpaceId: { in: authorizedSpaceIds } },
                    { toSpaceId: { in: authorizedSpaceIds } },
                  ],
                },
              },
            },
            {
              comments: {
                some: {
                  OR: [
                    { authorId: user.id },
                    { author: departmentStaffFilter },
                  ],
                },
              },
            },
            {
              contributors: {
                some: departmentStaffFilter,
              },
            },
          ],
        };

    // 2. Ticket Search Query Filter (SQLite Safe: NO mode: 'insensitive')
    const ticketSearchFilter: Prisma.TaskWhereInput =
      prioritizeType === 'people'
        ? {
            OR: [
              { assignee: { name: { contains: cleanQuery } } },
              { assignee: { username: { contains: cleanQuery } } },
              { createdBy: { name: { contains: cleanQuery } } },
              { createdBy: { username: { contains: cleanQuery } } },
            ],
          }
        : {
            OR: [
              { taskKey: { contains: cleanQuery } },
              { title: { contains: cleanQuery } },
              { description: { contains: cleanQuery } },
              { customFieldValues: { some: { value: { contains: cleanQuery } } } },
              { checklistItems: { some: { title: { contains: cleanQuery } } } },
              { attachments: { some: { fileName: { contains: cleanQuery } } } },
            ],
          };

    const ticketWhere: Prisma.TaskWhereInput = isSuperadmin
      ? ticketSearchFilter
      : {
          AND: [allowedTicketScope, ticketSearchFilter],
        };

    // 3. Spaces & Queues Query
    // Strictly restricted to id IN authorizedSpaceIds (or all for SUPERADMIN)
    const spaceWhere: Prisma.SpaceWhereInput = {
      name: { contains: cleanQuery },
      ...(isSuperadmin ? {} : { id: { in: authorizedSpaceIds } }),
    };

    const listWhere: Prisma.ListWhereInput = {
      name: { contains: cleanQuery },
      ...(isSuperadmin ? {} : { spaceId: { in: authorizedSpaceIds } }),
    };

    // 4. Comments & Internal Notes Query with Sanitization
    // Public comments (isInternal: false) searchable on any ticket within Allowed Search Scope
    // Internal notes (isInternal: true) ONLY searchable if SUPERADMIN OR task.spaceId IN authorizedSpaceIds
    let commentWhere: Prisma.TaskCommentWhereInput;
    if (isSuperadmin) {
      commentWhere = {
        content: { contains: cleanQuery },
      };
    } else {
      commentWhere = {
        content: { contains: cleanQuery },
        task: allowedTicketScope,
        OR: [
          { isInternal: false },
          {
            isInternal: true,
            task: {
              spaceId: { in: authorizedSpaceIds },
            },
          },
        ],
      };
    }

    // Execute parallel scoped queries
    const [ticketsRaw, matchingSpaces, matchingLists, commentsRaw] = await Promise.all([
      prioritizeType === 'spaces'
        ? Promise.resolve([])
        : prisma.task.findMany({
            where: ticketWhere,
            take: limit,
            orderBy: { updatedAt: 'desc' },
            select: {
              id: true,
              taskKey: true,
              title: true,
              description: true,
              priority: true,
              spaceId: true,
              listId: true,
              createdAt: true,
              updatedAt: true,
              space: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  key: true,
                  description: true,
                },
              },
              list: {
                select: {
                  id: true,
                  name: true,
                  color: true,
                },
              },
              status: {
                select: {
                  id: true,
                  name: true,
                  color: true,
                  isCompleted: true,
                  isClosed: true,
                },
              },
              assignee: {
                select: {
                  id: true,
                  name: true,
                  username: true,
                },
              },
            },
          }),
      prioritizeType === 'people'
        ? Promise.resolve([])
        : prisma.space.findMany({
            where: spaceWhere,
            take: Math.min(limit, 10),
            select: {
              id: true,
              name: true,
              key: true,
              slug: true,
              description: true,
            },
          }),
      prioritizeType === 'people'
        ? Promise.resolve([])
        : prisma.list.findMany({
            where: listWhere,
            take: Math.min(limit, 10),
            select: {
              id: true,
              name: true,
              color: true,
              spaceId: true,
              space: {
                select: {
                  id: true,
                  name: true,
                  key: true,
                  slug: true,
                  description: true,
                },
              },
            },
          }),
      prioritizeType === 'spaces'
        ? Promise.resolve([])
        : prisma.taskComment.findMany({
            where: commentWhere,
            take: limit,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              content: true,
              isInternal: true,
              createdAt: true,
              author: {
                select: {
                  id: true,
                  name: true,
                  username: true,
                },
              },
              task: {
                select: {
                  id: true,
                  taskKey: true,
                  title: true,
                  spaceId: true,
                  space: {
                    select: {
                      id: true,
                      name: true,
                      key: true,
                      description: true,
                    },
                  },
                },
              },
            },
          }),
    ]);

    // Format Tickets: include isCollaborated flag (task.spaceId NOT IN authorizedSpaceIds)
    const formattedTickets = ticketsRaw.map((task) => {
      const isCollaborated = !isSuperadmin && !authorizedSpaceIds.includes(task.spaceId);
      return {
        id: task.id,
        taskKey: task.taskKey,
        title: task.title,
        description: task.description,
        priority: task.priority,
        isCollaborated,
        space: {
          id: task.space.id,
          name: task.space.name,
          slug: task.space.slug,
          key: task.space.key,
          color: extractSpaceColor(task.space.description),
        },
        list: task.list
          ? {
              id: task.list.id,
              name: task.list.name,
              color: task.list.color,
            }
          : null,
        status: {
          id: task.status.id,
          name: task.status.name,
          color: task.status.color,
          isCompleted: task.status.isCompleted,
          isClosed: task.status.isClosed,
        },
        assignee: task.assignee
          ? {
              id: task.assignee.id,
              name: task.assignee.name,
              username: task.assignee.username,
            }
          : null,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      };
    });

    // Format Spaces & Queues
    const formattedSpaces = [
      ...matchingSpaces.map((s) => ({
        id: s.id,
        type: 'space' as const,
        spaceId: s.id,
        spaceName: s.name,
        spaceKey: s.key,
        listId: null,
        listName: null,
        color: extractSpaceColor(s.description),
      })),
      ...matchingLists.map((l) => ({
        id: l.id,
        type: 'queue' as const,
        spaceId: l.spaceId,
        spaceName: l.space.name,
        spaceKey: l.space.key,
        listId: l.id,
        listName: l.name,
        color: l.color || extractSpaceColor(l.space.description),
      })),
    ];

    // Format Comments: return snippet, author name, parent ticket summary
    const formattedComments = commentsRaw.map((c) => ({
      id: c.id,
      snippet: createSnippet(c.content, cleanQuery),
      isInternal: c.isInternal,
      createdAt: c.createdAt,
      author: {
        id: c.author.id,
        name: c.author.name,
        username: c.author.username,
      },
      task: {
        id: c.task.id,
        taskKey: c.task.taskKey,
        title: c.task.title,
        spaceId: c.task.spaceId,
        spaceName: c.task.space.name,
        spaceKey: c.task.space.key,
        spaceColor: extractSpaceColor(c.task.space.description),
      },
    }));

    const totalCount = formattedTickets.length + formattedSpaces.length + formattedComments.length;

    return NextResponse.json({
      query: rawQuery,
      tickets: formattedTickets,
      spaces: formattedSpaces,
      comments: formattedComments,
      totalCount,
    });
  } catch (error) {
    console.error('Global search error:', error);
    return NextResponse.json(
      { error: 'Internal server error processing global search.' },
      { status: 500 }
    );
  }
}
