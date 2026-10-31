import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { evaluateTaskSla } from '@/lib/sla';
import { runOpenCodeWithFallback } from '@/lib/ai/fallback';
import { aiQueueManager } from '@/lib/ai/ai-queue';

interface NarrativeReportRequest {
  spaceId?: string; // Optional only if SUPERADMIN requesting company-wide report
  startDate: string; // ISO or YYYY-MM-DD
  endDate: string; // ISO or YYYY-MM-DD
  jobId?: string; // Optional client-specified Job ID
}

export const maxDuration = 300; // Allow sufficient execution window for multi-model fallback chain in Next.js App Router

export async function POST(request: NextRequest) {
  // Hard Short-Circuit: AI Executive Narrative is in "Coming Soon" mode
  return NextResponse.json(
    {
      available: false,
      status: 'COMING_SOON',
      message: 'AI Executive Narrative is coming soon.',
    },
    { status: 503 }
  );
}

// Retained for future activation once local LLM engine is provisioned
async function _disabled_POST(request: NextRequest) {
  try {
    // 1. Authenticate Session
    let token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    const authHeader = request.headers.get('authorization');
    if (!token && authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }

    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized: Authentication required.' },
        { status: 401 }
      );
    }

    const sessionData = await validateSession(token);
    if (!sessionData) {
      return NextResponse.json(
        { error: 'Unauthorized: Session is expired or invalid.' },
        { status: 401 }
      );
    }

    const { user, assignedSpaceIds } = sessionData;

    // 2. Parse Input Payload
    let body: Partial<NarrativeReportRequest> = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Bad Request: Invalid JSON body.' },
        { status: 400 }
      );
    }

    const { spaceId, startDate, endDate } = body;

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'Bad Request: startDate and endDate parameters are required.' },
        { status: 400 }
      );
    }

    const start = new Date(startDate.includes('T') ? startDate : `${startDate}T00:00:00.000Z`);
    const end = new Date(endDate.includes('T') ? endDate : `${endDate}T23:59:59.999Z`);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json(
        { error: 'Bad Request: Invalid date format for startDate or endDate.' },
        { status: 400 }
      );
    }

    // 3. RBAC & Space Authorization Validation
    let targetSpace: { id: string; name: string; key: string; slaPolicy: any } | null = null;

    if (user.globalRole === 'SUPERADMIN') {
      if (spaceId) {
        targetSpace = await prisma.space.findUnique({
          where: { id: spaceId },
          select: {
            id: true,
            name: true,
            key: true,
            slaPolicy: true,
          },
        });
        if (!targetSpace) {
          return NextResponse.json(
            { error: `Space not found with ID '${spaceId}'.` },
            { status: 404 }
          );
        }
      }
      // If no spaceId, Superadmin gets organization-wide (company-wide) report
    } else {
      // Space staff (ADMIN or EMPLOYEE assigned to the space)
      if (!spaceId) {
        return NextResponse.json(
          { error: 'Forbidden: Department staff cannot generate company-wide reports. A spaceId is required.' },
          { status: 403 }
        );
      }

      targetSpace = await prisma.space.findUnique({
        where: { id: spaceId },
        select: {
          id: true,
          name: true,
          key: true,
          departmentHeadId: true,
          slaPolicy: true,
          members: {
            where: { userId: user.id },
            select: { id: true, role: true },
          },
        },
      });

      if (!targetSpace) {
        return NextResponse.json(
          { error: `Space not found with ID '${spaceId}'.` },
          { status: 404 }
        );
      }

      const isDeptHead = (targetSpace as any).departmentHeadId === user.id;
      const isMember = (targetSpace as any).members?.length > 0 || assignedSpaceIds.includes(spaceId);

      if (!isDeptHead && !isMember) {
        return NextResponse.json(
          { error: 'Forbidden: You do not have clearance for this department Space.' },
          { status: 403 }
        );
      }
    }

    // 4. Data Querying & Aggregation (Prisma & SQLite)
    const whereClause: any = {
      createdAt: {
        gte: start,
        lte: end,
      },
    };

    if (spaceId) {
      whereClause.spaceId = spaceId;
    }

    // Query handoff transfers for the period and department scope
    const handoffWhere: any = {
      actionType: 'HANDOFF_TRANSFER',
      createdAt: {
        gte: start,
        lte: end,
      },
    };

    if (spaceId) {
      handoffWhere.OR = [
        { fromSpaceId: spaceId },
        { toSpaceId: spaceId },
      ];
    }

    const [tasks, totalHandoffCount, handoffRecords] = await Promise.all([
      prisma.task.findMany({
        where: whereClause,
        select: {
          id: true,
          taskKey: true,
          title: true,
          description: true,
          priority: true,
          createdAt: true,
          customFields: true,
          status: {
            select: {
              id: true,
              name: true,
              isCompleted: true,
              isClosed: true,
            },
          },
          list: {
            select: {
              id: true,
              name: true,
            },
          },
          space: {
            select: {
              id: true,
              name: true,
              key: true,
              slaPolicy: true,
            },
          },
          assignee: {
            select: {
              id: true,
              name: true,
              username: true,
            },
          },
          comments: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: {
              content: true,
              createdAt: true,
              author: {
                select: {
                  name: true,
                },
              },
            },
          },
          history: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: {
              actionType: true,
              notes: true,
              fromQueueName: true,
              toQueueName: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.taskHistory.count({ where: handoffWhere }),
      prisma.taskHistory.findMany({
        where: handoffWhere,
        select: {
          id: true,
          actionType: true,
          fromSpaceId: true,
          toSpaceId: true,
          fromSpace: { select: { name: true, key: true } },
          toSpace: { select: { name: true, key: true } },
          fromQueueName: true,
          toQueueName: true,
          notes: true,
          createdAt: true,
          task: { select: { taskKey: true, title: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 15,
      }),
    ]);

    const total = tasks.length;
    const resolvedTickets = tasks.filter((t) => t.status.isCompleted || t.status.isClosed);
    const resolved = resolvedTickets.length;
    const activeTickets = tasks.filter((t) => !t.status.isCompleted && !t.status.isClosed);
    const active = activeTickets.length;

    let breachedCount = 0;
    tasks.forEach((t) => {
      const isFinished = t.status.isCompleted || t.status.isClosed;
      const ev = evaluateTaskSla(t.createdAt, t.priority, isFinished, t.space?.slaPolicy);
      let isBreached = ev?.isBreached ?? false;
      try {
        const cf = JSON.parse(t.customFields || '{}');
        if (cf.slaBreached) isBreached = true;
      } catch {}
      if (isBreached) breachedCount++;
    });

    const breachRate = total > 0 ? Math.round((breachedCount / total) * 100) : 0;
    const slaCompliancePct = total > 0 ? Math.max(0, 100 - breachRate) : 100;

    const targetSpaceName = targetSpace
      ? `${targetSpace.name} (${targetSpace.key})`
      : 'Organization-Wide (All Departments)';

    // Helper: format dwell time/age
    const formatDwellTime = (createdAt: Date): string => {
      const ms = Math.max(0, Date.now() - new Date(createdAt).getTime());
      const hours = Math.floor(ms / (1000 * 60 * 60));
      if (hours < 24) {
        return `${hours} hour${hours === 1 ? '' : 's'}`;
      }
      const days = (hours / 24).toFixed(1);
      return `${days} days (${hours} hours)`;
    };

    // Format active/unresolved tickets payload for prompt
    const activeTicketsPayload = activeTickets.map((t) => {
      const isFinished = false;
      const slaEval = evaluateTaskSla(t.createdAt, t.priority, isFinished, t.space?.slaPolicy);
      let isBreached = slaEval?.isBreached ?? false;
      try {
        const cf = JSON.parse(t.customFields || '{}');
        if (cf.slaBreached) isBreached = true;
      } catch {}

      let slaStatusStr = 'No SLA Policy';
      let slaRiskNote = 'On track';
      if (isBreached) {
        slaStatusStr = `Breached (${Math.floor(slaEval?.elapsedHours ?? 0)}h elapsed / ${slaEval?.thresholdHours ?? 0}h target)`;
        slaRiskNote = 'Imminent breach: SLA deadline has already lapsed. Urgent intervention required.';
      } else if (slaEval?.isWatch) {
        slaStatusStr = `Active - ${Math.round(slaEval.percentElapsed)}% elapsed`;
        slaRiskNote = 'Elevated Risk: Approaching threshold (>75% SLA elapsed).';
      } else if (slaEval) {
        slaStatusStr = `Active - ${Math.round(slaEval.percentElapsed)}% elapsed`;
        slaRiskNote = 'On track within standard threshold.';
      }

      // Latest activity / comment preview or last hand-off remark
      const latestComment = t.comments?.[0]?.content?.trim();
      const latestHandoff = t.history?.find((h) => h.notes)?.notes?.trim() || t.history?.[0]?.notes?.trim();
      let latestActivity = 'No comments or hand-off remarks recorded';
      if (latestComment) {
        latestActivity = `Comment: "${latestComment.slice(0, 150)}"`;
      } else if (latestHandoff) {
        latestActivity = `Hand-off remark: "${latestHandoff.slice(0, 150)}"`;
      } else if (t.description) {
        latestActivity = `Description: "${t.description.slice(0, 150)}"`;
      }

      const queueName = t.list?.name || 'Default Queue';
      const statusName = t.status?.name || 'Unknown';
      const assigneeName = t.assignee?.name || 'Unassigned';
      const dwellTime = formatDwellTime(t.createdAt);

      return {
        key: t.taskKey,
        title: t.title,
        statusName,
        queueName,
        statusAndQueue: `${statusName} - ${queueName}`,
        priority: t.priority,
        assignee: assigneeName,
        age: dwellTime,
        slaStatus: slaStatusStr,
        slaRiskNote,
        latestActivity,
      };
    });

    const activeTicketsListText =
      activeTicketsPayload.length > 0
        ? activeTicketsPayload
            .map(
              (t, i) =>
                `${i + 1}. Ticket ${t.key}: "${t.title}"
   - Status & Queue: ${t.statusAndQueue}
   - Priority: ${t.priority}
   - Current Assignee: ${t.assignee}
   - Backlog Age: ${t.age}
   - SLA Status: ${t.slaStatus}
   - SLA Risk Assessment: ${t.slaRiskNote}
   - Latest Activity Preview: ${t.latestActivity}`
            )
            .join('\n\n')
        : 'Zero active or unresolved tickets in this reporting window. The active backlog is completely clear.';

    // Format resolved tickets summary for prompt
    const resolvedTicketsPayload = resolvedTickets.slice(0, 15).map((t) => {
      const remark = t.comments?.[0]?.content?.trim() || t.history?.[0]?.notes?.trim() || t.description?.trim();
      return {
        key: t.taskKey,
        title: t.title,
        priority: t.priority,
        status: t.status.name,
        queue: t.list?.name || 'General',
        assignee: t.assignee?.name || 'Unassigned',
        resolutionRemark: remark ? `"${remark.slice(0, 120)}"` : 'Resolved successfully without special remarks',
      };
    });

    const resolvedTicketsListText =
      resolvedTicketsPayload.length > 0
        ? resolvedTicketsPayload
            .map(
              (t, i) =>
                `${i + 1}. ${t.key}: "${t.title}" [${t.priority}] | Status: ${t.status} | Queue: ${t.queue} | Contributor: ${t.assignee} | Remark: ${t.resolutionRemark}`
            )
            .join('\n')
        : 'Zero tickets resolved during this interval.';

    // Format handoffs summary for prompt
    const handoffsListText =
      handoffRecords.length > 0
        ? handoffRecords
            .map(
              (h, i) =>
                `${i + 1}. Ticket ${h.task?.taskKey || 'Task'}: Transferred from [${h.fromSpace?.name || 'External'}: ${h.fromQueueName || 'Queue'}] to [${h.toSpace?.name || 'External'}: ${h.toQueueName || 'Queue'}] on ${h.createdAt.toISOString().split('T')[0]}. Remarks: ${h.notes ? `"${h.notes}"` : 'None specified'}`
            )
            .join('\n')
        : 'No cross-department ticket transfers or queue handoffs recorded during this interval.';

    // 5. Construct AI Prompt & Execute
    const startDateFormatted = start.toISOString().split('T')[0];
    const endDateFormatted = end.toISOString().split('T')[0];

    const prompt = `You are the Senior Enterprise Technical Auditor.
Produce a comprehensive, rigorous Department Performance Narrative for executive leadership based strictly on the aggregated telemetry below:

========================
DEPARTMENT AUDIT CONTEXT
========================
Scope / Department: ${targetSpaceName}
Reporting Window: ${startDateFormatted} to ${endDateFormatted}

========================
OPERATIONAL TELEMETRY
========================
- Total Inflow (Tickets Created): ${total}
- Resolved Tickets: ${resolved}
- Open / Active Backlog: ${active}
- SLA Breaches: ${breachedCount} (Breach Rate: ${breachRate}%, Compliance Rate: ${slaCompliancePct}%)
- Total Inter-Department Handoff Transfers: ${totalHandoffCount}

====================================
ACTIVE / UNRESOLVED TICKET WATCHLIST (${active} tickets)
====================================
${activeTicketsListText}

=========================
RESOLVED TICKETS OVERVIEW (${resolved} tickets)
=========================
${resolvedTicketsListText}

=================================
CROSS-DEPARTMENT HANDOFF MOBILITY (${totalHandoffCount} transfers)
=================================
${handoffsListText}

=========================
REPORT STRUCTURE GUIDELINES
=========================
Format your response strictly using the following 6 numbered markdown section headers (use the exact header titles below):

### 1. Executive Summary & Operational Velocity
- Provide a high-level executive synthesis of operational throughput, workload balance, and stability for ${targetSpaceName}.
- Analyze operational velocity and capacity to absorb incoming ticket flow.

### 2. Key Issues Resolved & Operational Accomplishments
- Detail specific accomplishments and tickets resolved during this reporting window.
- Highlight resolutions applied, problem domains tackled, and contributions by staff members.
- If zero tickets were resolved, explicitly state that no tickets reached resolution in this window.

### 3. Operational & SLA Telemetry Table
- Generate a clean Markdown metric table comparing key volume and SLA indicators:
| Metric | Value |
| Total Inflow | ${total} |
| Resolved | ${resolved} |
| Open / Active | ${active} |
| SLA Compliance % | ${slaCompliancePct}% |
| Handoff Count | ${totalHandoffCount} |
- Follow the table with concise analytical commentary explaining velocity and compliance trends.

### 4. Cross-Department Collaboration & Queue Dynamics
- Evaluate cross-department collaboration, queue flow dynamics, and ticket mobility (transfers between queues and spaces).
- Highlight transfer clarity, notes/remarks quality, and potential bottlenecks or bounce-backs across teams based on the handoff data.

### 5. Active Backlog & Unresolved Ticket Watchlist
- List and evaluate all currently open or pending tickets from the telemetry:
${
  activeTicketsPayload.length > 0
    ? `For each active ticket, explicitly detail:
  - Ticket Key & Title (e.g., "[Key]: [Title]")
  - Current Status, Queue, and Assignee (flag if Unassigned)
  - Backlog Age (dwell time sitting open)
  - SLA Risk Assessment (evaluate whether it is on track, blocked awaiting response, or in danger of imminent breach based on priority and elapsed time)
  - Remarks / Activity preview`
    : `State clearly and explicitly that there are 0 active or pending tickets, and the queue is fully cleared with zero outstanding backlogs.`
}
- Provide audit commentary highlighting any high-age items, unassigned tickets, or tickets at risk of SLA breach.

### 6. Actionable Leadership Recommendations
- Provide 3 to 5 concrete, prioritized operational takeaways for leadership.
- Base recommendations on both completed resolutions and the active unresolved backlog (e.g., reassignments, queue rebalancing, SLA prevention).

Ensure your analysis is department-agnostic, objective, professional, and directly references the telemetry provided above.`;

    const jobId = body.jobId || `ai_job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const executeJob = async (signal?: AbortSignal) => {
      const fallbackResult = await runOpenCodeWithFallback(prompt, { signal });
      return {
        narrative: fallbackResult.result,
        generatedAt: new Date().toISOString(),
        usedModel: fallbackResult.usedModel,
        usedModelName: fallbackResult.usedModelName,
        isFallback: fallbackResult.isFallback,
        fallbackChain: fallbackResult.fallbackChain,
      };
    };

    const lock = aiQueueManager.acquireOrEnqueue({
      id: jobId,
      departmentName: targetSpaceName,
      userId: user.id,
      userName: user.name,
      execute: executeJob,
    });

    // If engine is currently busy with another generation, return 200 with QUEUED metadata
    if (!lock.acquired) {
      return NextResponse.json({
        busy: true,
        status: 'QUEUED',
        jobId: lock.jobId,
        queuePosition: lock.queuePosition,
        totalInQueue: lock.totalInQueue,
        activeDepartment: lock.activeDepartment,
        activeElapsedSeconds: lock.activeElapsedSeconds,
        message: `AI Engine is busy. You are #${lock.queuePosition} in line.`,
      }, { status: 200 });
    }

    // Engine is free and lock acquired immediately
    try {
      const result = await executeJob();
      aiQueueManager.completeJob(lock.jobId, result);
      return NextResponse.json(result);
    } catch (err: any) {
      aiQueueManager.failJob(lock.jobId, err.message || 'Failed to synthesize AI narrative report.');
      throw err;
    }
  } catch (error: any) {
    console.error('[API /api/admin/reports/ai-narrative Error]:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to synthesize AI narrative report.' },
      { status: 500 }
    );
  }
}
