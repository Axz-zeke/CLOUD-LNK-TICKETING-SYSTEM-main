import { NextRequest, NextResponse } from 'next/server';
import { aiQueueManager } from '@/lib/ai/ai-queue';
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

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user } = auth;
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');

    if (jobId) {
      const jobOwnerId = aiQueueManager.getJobOwner(jobId);
      if (jobOwnerId && user.globalRole !== 'SUPERADMIN' && jobOwnerId !== user.id) {
        return NextResponse.json(
          { error: 'Forbidden: You do not have clearance to view this report generation job.' },
          { status: 403 }
        );
      }

      const status = aiQueueManager.getJobStatus(jobId);
      return NextResponse.json(status);
    }

    // Snapshot of the entire queue is restricted to ADMIN or SUPERADMIN
    if (user.globalRole !== 'ADMIN' && user.globalRole !== 'SUPERADMIN') {
      return NextResponse.json(
        { error: 'Forbidden: Admin clearance required to inspect AI queue status.' },
        { status: 403 }
      );
    }

    const snapshot = aiQueueManager.getSnapshot();
    return NextResponse.json(snapshot);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to inspect AI queue' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user } = auth;
    const body = await request.json().catch(() => ({}));
    const { jobId, action } = body;

    // Reject new AI jobs immediately with Coming Soon status
    if (action && action !== 'cancel' && action !== 'CANCEL') {
      return NextResponse.json(
        {
          available: false,
          status: 'COMING_SOON',
          message: 'AI Executive Narrative is coming soon.',
        },
        { status: 503 }
      );
    }

    if (!jobId) {
      return NextResponse.json({ error: 'Missing jobId in request body' }, { status: 400 });
    }

    const jobOwnerId = aiQueueManager.getJobOwner(jobId);
    if (jobOwnerId && user.globalRole !== 'SUPERADMIN' && jobOwnerId !== user.id) {
      return NextResponse.json(
        { error: 'Forbidden: You do not have clearance to cancel this report job.' },
        { status: 403 }
      );
    }

    if (action === 'cancel' || !action) {
      const result = aiQueueManager.cancelJob(jobId);
      return NextResponse.json({
        success: true,
        jobId,
        ...result,
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to process queue action' },
      { status: 500 }
    );
  }
}
