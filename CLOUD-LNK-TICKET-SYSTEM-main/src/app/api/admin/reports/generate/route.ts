import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { evaluateTaskSla } from '@/lib/sla';
import { runOpenCodeWithFallback } from '@/lib/ai/fallback';
import { aiQueueManager } from '@/lib/ai/ai-queue';

import { checkRateLimit } from '@/lib/security/rate-limit';

export const maxDuration = 300; // Allow sufficient execution window for multi-model fallback chain in Next.js App Router

export async function POST(request: NextRequest) {
  try {
    // 1. Session Clearance Verification (ADMIN or SUPERADMIN)
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
    if (user.globalRole !== 'ADMIN' && user.globalRole !== 'SUPERADMIN') {
      return NextResponse.json(
        { error: 'Forbidden: Admin clearance required to generate executive reports.' },
        { status: 403 }
      );
    }

    // Rate limit: max 5 report requests per minute per admin
    const rateLimit = checkRateLimit(`report-generate:${user.id}`, { maxRequests: 5, windowMs: 60 * 1000 });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many report generation requests. Please wait before generating another report.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
      );
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch {}

    // Department scoping: Superadmin can view all or specific space, Admin is restricted to assigned spaces
    const targetSpaceIds = user.globalRole === 'SUPERADMIN'
      ? (body.spaceId ? [body.spaceId] : null)
      : (body.spaceId ? [body.spaceId] : assignedSpaceIds);

    if (user.globalRole === 'ADMIN') {
      if (body.spaceId && !assignedSpaceIds.includes(body.spaceId)) {
        return NextResponse.json(
          { error: 'Forbidden: You do not have administrative clearance to access report telemetry for this department.' },
          { status: 403 }
        );
      }
      if (!targetSpaceIds || targetSpaceIds.length === 0) {
        return NextResponse.json(
          { error: 'Forbidden: You have no assigned departments to generate executive reports for.' },
          { status: 403 }
        );
      }
    }

    // 2. Fetch and aggregate tickets from SQLite via Prisma
    const taskWhere: any = targetSpaceIds ? { spaceId: { in: targetSpaceIds } } : {};
    const spaceWhere: any = targetSpaceIds ? { id: { in: targetSpaceIds } } : {};

    const [tasks, spaces] = await Promise.all([
      prisma.task.findMany({
        where: taskWhere,
        select: {
          id: true,
          taskKey: true,
          title: true,
          description: true,
          priority: true,
          createdAt: true,
          updatedAt: true,
          customFields: true,
          status: {
            select: {
              id: true,
              name: true,
              isCompleted: true,
              isClosed: true,
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
            },
          },
        },
      }),
      prisma.space.findMany({
        where: spaceWhere,
        select: {
          id: true,
          name: true,
          key: true,
          slaPolicy: true,
        },
      }),
    ]);

    // Group counts by status
    const statusCounts = {
      OPEN: 0,
      IN_PROGRESS: 0,
      PENDING_USER: 0,
      RESOLVED: 0,
      CLOSED: 0,
    };

    let totalBreaches = 0;
    let totalWatch = 0;

    tasks.forEach((task) => {
      const isCompleted = task.status.isCompleted;
      const isClosed = task.status.isClosed;
      const statusName = task.status.name.toLowerCase();

      if (isClosed) {
        statusCounts.CLOSED++;
      } else if (isCompleted) {
        statusCounts.RESOLVED++;
      } else if (/pend|wait|review|block/i.test(statusName)) {
        statusCounts.PENDING_USER++;
      } else if (/prog|wip|active|doing|investigat/i.test(statusName)) {
        statusCounts.IN_PROGRESS++;
      } else {
        statusCounts.OPEN++;
      }

      // SLA evaluation
      const slaEval = evaluateTaskSla(
        task.createdAt,
        task.priority,
        isCompleted || isClosed,
        task.space?.slaPolicy
      );

      let breached = slaEval?.isBreached ?? false;
      let watch = slaEval?.isWatch ?? false;

      try {
        const cf = JSON.parse(task.customFields || '{}');
        if (cf.slaBreached) breached = true;
      } catch {
        // ignore JSON parse error
      }

      if (breached) totalBreaches++;
      if (watch) totalWatch++;
    });

    // Group telemetry by Space
    const departmentTelemetry = spaces.map((sp) => {
      const spaceTasks = tasks.filter((t) => t.space?.id === sp.id);
      const activeTasks = spaceTasks.filter(
        (t) => !t.status.isCompleted && !t.status.isClosed
      );
      const resolvedTasks = spaceTasks.filter(
        (t) => t.status.isCompleted || t.status.isClosed
      );

      const breachCount = spaceTasks.filter((t) => {
        const isFinished = t.status.isCompleted || t.status.isClosed;
        const ev = evaluateTaskSla(t.createdAt, t.priority, isFinished, sp.slaPolicy);
        let b = ev?.isBreached ?? false;
        try {
          const cf = JSON.parse(t.customFields || '{}');
          if (cf.slaBreached) b = true;
        } catch {}
        return b;
      }).length;

      return {
        department: sp.name,
        key: sp.key,
        submitted: spaceTasks.length,
        active: activeTasks.length,
        resolved: resolvedTasks.length,
        breachCount,
      };
    });

    // Top 5 critical / urgent tickets
    const priorityWeight: Record<string, number> = {
      URGENT: 4,
      HIGH: 3,
      NORMAL: 2,
      LOW: 1,
    };

    const criticalEscalations = tasks
      .filter((t) => !t.status.isCompleted && !t.status.isClosed)
      .sort((a, b) => {
        const pDiff = (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0);
        if (pDiff !== 0) return pDiff;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      })
      .slice(0, 5)
      .map((t) => ({
        key: t.taskKey,
        title: t.title,
        department: t.space?.name || 'General',
        priority: t.priority,
        status: t.status.name,
        assignee: t.assignee?.name || 'Unassigned',
        elapsedDays: ((Date.now() - new Date(t.createdAt).getTime()) / (1000 * 3600 * 24)).toFixed(1),
        notesOrDescription: (t.comments[0]?.content || t.description || 'No description').slice(0, 150),
      }));

    // 3. Compact metrics payload
    const metricsPayload = {
      reportDate: new Date().toISOString(),
      ticketOverview: {
        total: tasks.length,
        statusBreakdown: statusCounts,
      },
      slaTelemetry: {
        totalBreached: totalBreaches,
        imminentWarnings: totalWatch,
        complianceRatePct:
          tasks.length > 0
            ? Math.round(((tasks.length - totalBreaches) / tasks.length) * 100)
            : 100,
      },
      departmentTelemetry,
      criticalEscalations,
    };

    // 4. Prompt OpenCode
    const prompt = `You are the Senior Technical Operations Analyst. Generate a high-density, formal Executive Operations Briefing for department heads based strictly on the provided JSON telemetry:
${JSON.stringify(metricsPayload, null, 2)}

Requirements:
1. Executive Summary & Operational Health Posture (concise assessment).
2. Cross-Department Telemetry Table (Tickets submitted, active, resolved, breach count).
3. High-Risk Operational Bottlenecks & SLA Failure Points.
4. Strategic Tactical Action Items for Leadership.
Format cleanly in Markdown.`;

    // 5. Headless OpenCode execution with concurrency lock & queue
    const jobId = body?.jobId || `ai_job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const executeJob = async (signal?: AbortSignal) => {
      const fallbackResult = await runOpenCodeWithFallback(prompt, { signal });
      return {
        report: fallbackResult.result,
        generatedAt: new Date().toISOString(),
        usedModel: fallbackResult.usedModel,
        usedModelName: fallbackResult.usedModelName,
        isFallback: fallbackResult.isFallback,
        fallbackChain: fallbackResult.fallbackChain,
      };
    };

    const lock = aiQueueManager.acquireOrEnqueue({
      id: jobId,
      departmentName: 'Executive Operations Briefing',
      userId: sessionData.user.id,
      userName: sessionData.user.name,
      execute: executeJob,
    });

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

    try {
      const result = await executeJob();
      aiQueueManager.completeJob(lock.jobId, result);
      return NextResponse.json(result);
    } catch (err: any) {
      aiQueueManager.failJob(lock.jobId, err.message || 'Failed to synthesize executive AI report.');
      throw err;
    }
  } catch (error: any) {
    console.error('[API /api/admin/reports/generate Error]:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to synthesize executive AI report.' },
      { status: 500 }
    );
  }
}
