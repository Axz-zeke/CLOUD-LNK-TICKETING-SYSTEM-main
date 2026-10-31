import { NextRequest, NextResponse } from 'next/server';
import { aiQueueManager } from '@/lib/ai/ai-queue';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';

export const maxDuration = 300;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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

    const { user } = sessionData;
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Missing job ID' }, { status: 400 });
    }

    // Clearance check: Only SUPERADMIN or the user who created this job can read its status/results
    const jobOwnerId = aiQueueManager.getJobOwner(id);
    if (jobOwnerId && user.globalRole !== 'SUPERADMIN' && jobOwnerId !== user.id) {
      return NextResponse.json(
        { error: 'Forbidden: You do not have clearance to view this report generation job.' },
        { status: 403 }
      );
    }

    const status = aiQueueManager.getJobStatus(id);
    return NextResponse.json(status);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to retrieve job status' },
      { status: 500 }
    );
  }
}
