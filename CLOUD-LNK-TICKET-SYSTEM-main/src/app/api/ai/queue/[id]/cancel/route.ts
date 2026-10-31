import { NextRequest, NextResponse } from 'next/server';
import { aiQueueManager } from '@/lib/ai/ai-queue';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';

export async function POST(
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

    // Authorization: Only job owner or Superadmin can cancel an AI synthesis job
    const jobOwnerId = aiQueueManager.getJobOwner(id);
    if (jobOwnerId && user.globalRole !== 'SUPERADMIN' && jobOwnerId !== user.id) {
      return NextResponse.json(
        { error: 'Forbidden: You do not have clearance to cancel this report job.' },
        { status: 403 }
      );
    }

    const result = aiQueueManager.cancelJob(id);
    return NextResponse.json({
      success: true,
      jobId: id,
      ...result,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to cancel job' },
      { status: 500 }
    );
  }
}
