import { NextRequest, NextResponse } from 'next/server';
import { aiQueueManager } from '@/lib/ai/ai-queue';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Missing job ID' }, { status: 400 });
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

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Missing job ID' }, { status: 400 });
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

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // Support POST on [id] as alias for cancel
  return DELETE(request, context);
}
