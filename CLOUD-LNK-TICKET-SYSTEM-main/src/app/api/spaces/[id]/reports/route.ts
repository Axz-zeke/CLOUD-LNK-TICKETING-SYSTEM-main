import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';

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

function formatDate(d: Date): string {
  try {
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return d.toISOString().split('T')[0];
  }
}

interface MemberMetrics {
  memberId: string;
  name: string;
  username: string;
  totalAssigned: number;
  resolvedCount: number;
  inProgressCount: number;
  urgentHandled: number;
  tickets: Array<{
    key: string;
    title: string;
    priority: string;
    status: string;
    summary: string;
  }>;
}

function generateLocalMarkdownReport(params: {
  spaceName: string;
  startDate: Date;
  endDate: Date;
  departmentHeadName: string;
  totalTickets: number;
  resolvedCount: number;
  resolvedRate: number;
  inProgressCount: number;
  inProgressRate: number;
  urgentHighCount: number;
  urgentHighRate: number;
  memberList: MemberMetrics[];
  unassignedMetrics: MemberMetrics;
  tasks: Array<{
    taskKey: string;
    title: string;
    priority: string;
    status: { name: string };
    assignee: { name: string } | null;
  }>;
  aiUnavailableNote?: boolean;
}): string {
  const {
    spaceName,
    startDate,
    endDate,
    departmentHeadName,
    totalTickets,
    resolvedCount,
    resolvedRate,
    inProgressCount,
    inProgressRate,
    urgentHighCount,
    urgentHighRate,
    memberList,
    unassignedMetrics,
    tasks,
    aiUnavailableNote,
  } = params;

  let memberRows = '';
  if (memberList.length === 0 && unassignedMetrics.totalAssigned === 0) {
    memberRows = '| *No tickets assigned* | 0 | 0 | 0 | 0 |\n';
  } else {
    for (const m of memberList) {
      memberRows += `| ${m.name} (@${m.username}) | ${m.totalAssigned} | ${m.resolvedCount} | ${m.inProgressCount} | ${m.urgentHandled} |\n`;
    }
    if (unassignedMetrics.totalAssigned > 0) {
      memberRows += `| *Unassigned Queue* | ${unassignedMetrics.totalAssigned} | ${unassignedMetrics.resolvedCount} | ${unassignedMetrics.inProgressCount} | ${unassignedMetrics.urgentHandled} |\n`;
    }
  }

  let taskListMarkdown = '';
  if (tasks.length === 0) {
    taskListMarkdown = '*No tickets logged in the selected interval.*';
  } else {
    taskListMarkdown = tasks
      .slice(0, 50)
      .map(
        (t) =>
          `- **[${t.taskKey}] ${t.title}**  \n  *Assignee:* ${
            t.assignee ? t.assignee.name : 'Unassigned'
          } | *Status:* ${t.status.name} | *Priority:* ${t.priority}`
      )
      .join('\n');
    if (tasks.length > 50) {
      taskListMarkdown += `\n\n*... and ${tasks.length - 50} more tickets.*`;
    }
  }

  const prefix = aiUnavailableNote
    ? `*(Generated via local analytics engine; external AI unavailable)*\n\n`
    : '';

  return `${prefix}# Department Performance Audit: ${spaceName}
**Platform:** AIO Work Management System | L&K Industries  
**Audit Interval:** ${formatDate(startDate)} to ${formatDate(endDate)}  
**Department Head:** ${departmentHeadName}  
**Report Engine:** Local Analytics Engine (100% Air-Gapped / Offline)  

---

### 1. Executive Throughput & Key Metrics
| Metric | Count | Percentage |
| :--- | :--- | :--- |
| **Total Department Tickets** | ${totalTickets} | 100% |
| **Resolved / Closed** | ${resolvedCount} | ${resolvedRate}% |
| **Active / In Progress** | ${inProgressCount} | ${inProgressRate}% |
| **Urgent & High Priority Incidents** | ${urgentHighCount} | ${urgentHighRate}% |

---

### 2. Team Member Workload & Activity Breakdown
| Member | Assigned | Resolved | In Progress | Urgent / High |
| :--- | :---: | :---: | :---: | :---: |
${memberRows.trimEnd()}

---

### 3. Detailed Incident & Resolution Log
${taskListMarkdown}
`;
}

// POST /api/spaces/[id]/reports - Local Deterministic Department Activity Report & Optional AI Synthesis
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { user } = auth;
    const { id } = await context.params;

    // 1. Fetch space & verify access
    const space = await prisma.space.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        key: true,
        departmentHeadId: true,
        departmentHead: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
    });

    if (!space) {
      return NextResponse.json({ error: 'Department space not found.' }, { status: 404 });
    }

    // Access Rule: Only the designated space.departmentHeadId === user.id OR user.globalRole === 'SUPERADMIN'
    const isHead = space.departmentHeadId === user.id;
    const isSuperadmin = user.globalRole === 'SUPERADMIN';

    if (!isHead && !isSuperadmin) {
      return NextResponse.json(
        { error: 'Only the designated Department Head or a Superadmin can generate departmental activity reports.' },
        { status: 403 }
      );
    }

    // 2. Parse request payload for date filters and mode
    const body = await request.json().catch(() => ({}));
    const { startDate, endDate, mode = 'standard' } = body;

    let start: Date;
    let end: Date;

    if (startDate && !isNaN(new Date(startDate).getTime())) {
      start = new Date(startDate);
    } else {
      start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    }

    if (endDate && !isNaN(new Date(endDate).getTime())) {
      end = new Date(endDate);
    } else {
      end = new Date();
    }

    // 3. Departmental Activity Aggregation (Prisma & SQLite)
    const tasks = await prisma.task.findMany({
      where: {
        spaceId: space.id,
        OR: [
          { updatedAt: { gte: start, lte: end } },
          { createdAt: { gte: start, lte: end } },
        ],
      },
      include: {
        assignee: { select: { id: true, name: true, username: true } },
        createdBy: { select: { id: true, name: true, username: true } },
        status: { select: { id: true, name: true, isCompleted: true, isClosed: true } },
        comments: {
          where: { isInternal: false },
          select: {
            id: true,
            content: true,
            createdAt: true,
            author: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 3,
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // Calculate throughput KPIs
    const totalTickets = tasks.length;
    let resolvedCount = 0;
    let inProgressCount = 0;
    let urgentHighCount = 0;

    for (const t of tasks) {
      const isCompleted =
        t.status.isCompleted ||
        t.status.isClosed ||
        t.status.name.toLowerCase().includes('close') ||
        t.status.name.toLowerCase().includes('resolve') ||
        t.status.name.toLowerCase().includes('done');

      if (isCompleted) {
        resolvedCount++;
      } else {
        inProgressCount++;
      }

      if (t.priority === 'HIGH' || t.priority === 'URGENT') {
        urgentHighCount++;
      }
    }

    const resolvedRate = totalTickets > 0 ? Math.round((resolvedCount / totalTickets) * 100) : 0;
    const inProgressRate = totalTickets > 0 ? Math.round((inProgressCount / totalTickets) * 100) : 0;
    const urgentHighRate = totalTickets > 0 ? Math.round((urgentHighCount / totalTickets) * 100) : 0;

    // 4. Group data by department member
    const memberMap = new Map<string, MemberMetrics>();
    const unassignedMetrics: MemberMetrics = {
      memberId: 'unassigned',
      name: 'Unassigned Queue',
      username: 'unassigned',
      totalAssigned: 0,
      resolvedCount: 0,
      inProgressCount: 0,
      urgentHandled: 0,
      tickets: [],
    };

    for (const t of tasks) {
      const isCompleted =
        t.status.isCompleted ||
        t.status.isClosed ||
        t.status.name.toLowerCase().includes('close') ||
        t.status.name.toLowerCase().includes('resolve') ||
        t.status.name.toLowerCase().includes('done');
      const isUrgentHigh = t.priority === 'HIGH' || t.priority === 'URGENT';

      const latestComment = t.comments[0]?.content;
      const summary = latestComment
        ? (latestComment.length > 120 ? latestComment.substring(0, 117) + '...' : latestComment)
        : (t.description
            ? (t.description.length > 120 ? t.description.substring(0, 117) + '...' : t.description)
            : 'No resolution notes.');

      const ticketItem = {
        key: t.taskKey,
        title: t.title,
        priority: t.priority,
        status: t.status.name,
        summary,
      };

      if (!t.assignee) {
        unassignedMetrics.totalAssigned++;
        if (isCompleted) unassignedMetrics.resolvedCount++;
        else unassignedMetrics.inProgressCount++;
        if (isUrgentHigh) unassignedMetrics.urgentHandled++;
        unassignedMetrics.tickets.push(ticketItem);
      } else {
        const mId = t.assignee.id;
        if (!memberMap.has(mId)) {
          memberMap.set(mId, {
            memberId: mId,
            name: t.assignee.name,
            username: t.assignee.username,
            totalAssigned: 0,
            resolvedCount: 0,
            inProgressCount: 0,
            urgentHandled: 0,
            tickets: [],
          });
        }

        const entry = memberMap.get(mId)!;
        entry.totalAssigned++;
        if (isCompleted) entry.resolvedCount++;
        else entry.inProgressCount++;
        if (isUrgentHigh) entry.urgentHandled++;
        entry.tickets.push(ticketItem);
      }
    }

    const memberList = Array.from(memberMap.values()).sort((a, b) => b.totalAssigned - a.totalAssigned);

    const headName = space.departmentHead
      ? `${space.departmentHead.name} (@${space.departmentHead.username})`
      : 'Unassigned / Vacant';

    const localReport = generateLocalMarkdownReport({
      spaceName: space.name,
      startDate: start,
      endDate: end,
      departmentHeadName: headName,
      totalTickets,
      resolvedCount,
      resolvedRate,
      inProgressCount,
      inProgressRate,
      urgentHighCount,
      urgentHighRate,
      memberList,
      unassignedMetrics,
      tasks,
    });

    const rawUrl = process.env.OPENCODE_API_URL;
    const OPENCODE_API_URL =
      rawUrl && rawUrl !== 'undefined'
        ? rawUrl
        : 'https://api.openai.com/v1/chat/completions';
    const OPENCODE_API_KEY = process.env.OPENCODE_API_KEY || '';
    const OPENCODE_MODEL = process.env.OPENCODE_MODEL || 'gpt-4o-mini';

    const hasValidKey =
      OPENCODE_API_KEY.trim() !== '' &&
      !OPENCODE_API_KEY.toLowerCase().includes('placeholder') &&
      OPENCODE_API_KEY !== 'undefined';

    // 5. Execution Flow
    // If standard mode OR if OPENCODE_API_KEY is undefined/placeholder:
    if (mode === 'standard' || !hasValidKey) {
      return NextResponse.json({
        reportMarkdown: localReport,
        generatedAt: new Date().toISOString(),
        ticketCount: totalTickets,
        spaceName: space.name,
        mode: 'standard',
      });
    }

    // If mode === 'ai' and a valid API key is present:
    try {
      const systemPrompt = `You are an executive operational auditor and enterprise IT director. Analyze the department activity log for ${space.name} between ${start.toISOString()} and ${end.toISOString()}. Synthesize a concise, professional markdown report covering: 1. Executive Summary & Department Throughput, 2. Individual Member Performance & Key Accomplishments, 3. Operational Bottlenecks & Recurring Incidents, 4. Actionable Staffing & Queue Recommendations.`;

      const userPromptPayload = {
        department: space.name,
        departmentKey: space.key,
        dateRange: {
          start: start.toISOString(),
          end: end.toISOString(),
        },
        totalTicketsInPeriod: totalTickets,
        unassignedTicketsInPeriod: unassignedMetrics.totalAssigned,
        activeMembersCount: memberList.length,
        memberActivityBreakdown: memberList.map((m) => ({
          name: m.name,
          username: m.username,
          totalAssigned: m.totalAssigned,
          resolvedCount: m.resolvedCount,
          inProgressCount: m.inProgressCount,
          urgentHandled: m.urgentHandled,
          ticketsSample: m.tickets.slice(0, 10),
        })),
      };

      const apiRes = await fetch(OPENCODE_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENCODE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: OPENCODE_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(userPromptPayload, null, 2) },
          ],
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(15000), // 15-second timeout as required
      });

      if (!apiRes.ok) {
        console.warn(`Upstream AI API returned non-200: ${apiRes.status} ${apiRes.statusText}. Cleanly falling back to local deterministic report.`);
        const fallbackReport = generateLocalMarkdownReport({
          spaceName: space.name,
          startDate: start,
          endDate: end,
          departmentHeadName: headName,
          totalTickets,
          resolvedCount,
          resolvedRate,
          inProgressCount,
          inProgressRate,
          urgentHighCount,
          urgentHighRate,
          memberList,
          unassignedMetrics,
          tasks,
          aiUnavailableNote: true,
        });
        return NextResponse.json({
          reportMarkdown: fallbackReport,
          generatedAt: new Date().toISOString(),
          ticketCount: totalTickets,
          spaceName: space.name,
          mode: 'fallback',
        });
      }

      const aiData = await apiRes.json();
      const reportMarkdown = aiData.choices?.[0]?.message?.content;

      if (!reportMarkdown) {
        console.warn('Upstream AI API response missing message content. Cleanly falling back to local deterministic report.');
        const fallbackReport = generateLocalMarkdownReport({
          spaceName: space.name,
          startDate: start,
          endDate: end,
          departmentHeadName: headName,
          totalTickets,
          resolvedCount,
          resolvedRate,
          inProgressCount,
          inProgressRate,
          urgentHighCount,
          urgentHighRate,
          memberList,
          unassignedMetrics,
          tasks,
          aiUnavailableNote: true,
        });
        return NextResponse.json({
          reportMarkdown: fallbackReport,
          generatedAt: new Date().toISOString(),
          ticketCount: totalTickets,
          spaceName: space.name,
          mode: 'fallback',
        });
      }

      return NextResponse.json({
        reportMarkdown,
        generatedAt: new Date().toISOString(),
        ticketCount: totalTickets,
        spaceName: space.name,
        mode: 'ai',
      });
    } catch (upstreamErr: any) {
      console.warn('AI Upstream Connection Failed (Offline / Unreachable):', upstreamErr?.message || upstreamErr);
      const fallbackReport = generateLocalMarkdownReport({
        spaceName: space.name,
        startDate: start,
        endDate: end,
        departmentHeadName: headName,
        totalTickets,
        resolvedCount,
        resolvedRate,
        inProgressCount,
        inProgressRate,
        urgentHighCount,
        urgentHighRate,
        memberList,
        unassignedMetrics,
        tasks,
        aiUnavailableNote: true,
      });
      return NextResponse.json({
        reportMarkdown: fallbackReport,
        generatedAt: new Date().toISOString(),
        ticketCount: totalTickets,
        spaceName: space.name,
        mode: 'fallback',
      });
    }
  } catch (error) {
    console.error('Failed to generate departmental report:', error);
    return NextResponse.json(
      { error: 'An unexpected internal error occurred while generating the report.' },
      { status: 500 }
    );
  }
}
