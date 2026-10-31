import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { DEFAULT_SLA_POLICY } from '@/lib/sla';

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

/**
 * GET /api/spaces/[id]/sla
 * Returns the existing SLA policy for the Space, or the default system baseline.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id } = await context.params;

    const space = await prisma.space.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        key: true,
        departmentHeadId: true,
        slaPolicy: true,
      },
    });

    if (!space) {
      return NextResponse.json({ error: 'Department space not found.' }, { status: 404 });
    }

    if (space.slaPolicy) {
      return NextResponse.json({
        policy: space.slaPolicy,
        isDefault: false,
      });
    }

    return NextResponse.json({
      policy: {
        spaceId: space.id,
        urgentHours: DEFAULT_SLA_POLICY.urgentHours,
        highHours: DEFAULT_SLA_POLICY.highHours,
        normalHours: DEFAULT_SLA_POLICY.normalHours,
        lowHours: DEFAULT_SLA_POLICY.lowHours,
      },
      isDefault: true,
    });
  } catch (error) {
    console.error('Error fetching SLA policy:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Internal server error while fetching SLA policy.',
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/spaces/[id]/sla
 * Updates or creates the SLA policy for a department space.
 * Authorization: Strictly SUPERADMIN or designated Department Head (space.departmentHeadId === user.id).
 */
export async function PUT(
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

    const space = await prisma.space.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        key: true,
        departmentHeadId: true,
      },
    });

    if (!space) {
      return NextResponse.json({ error: 'Department space not found.' }, { status: 404 });
    }

    const isSuperadmin = user.globalRole === 'SUPERADMIN';
    const isDepartmentHead = space.departmentHeadId === user.id;

    if (!isSuperadmin && !isDepartmentHead) {
      return NextResponse.json(
        {
          error:
            'Forbidden: Only the designated Department Head or a Superadmin can configure departmental SLA policies.',
        },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { urgentHours, highHours, normalHours, lowHours } = body;

    const parsedUrgent = Math.max(1, Math.min(720, Math.round(Number(urgentHours) || DEFAULT_SLA_POLICY.urgentHours)));
    const parsedHigh = Math.max(1, Math.min(720, Math.round(Number(highHours) || DEFAULT_SLA_POLICY.highHours)));
    const parsedNormal = Math.max(1, Math.min(720, Math.round(Number(normalHours) || DEFAULT_SLA_POLICY.normalHours)));
    const parsedLow = Math.max(1, Math.min(720, Math.round(Number(lowHours) || DEFAULT_SLA_POLICY.lowHours)));

    const updatedPolicy = await prisma.slaPolicy.upsert({
      where: { spaceId: space.id },
      create: {
        spaceId: space.id,
        urgentHours: parsedUrgent,
        highHours: parsedHigh,
        normalHours: parsedNormal,
        lowHours: parsedLow,
      },
      update: {
        urgentHours: parsedUrgent,
        highHours: parsedHigh,
        normalHours: parsedNormal,
        lowHours: parsedLow,
      },
    });

    // Record audit log entry
    try {
      await prisma.auditLog.create({
        data: {
          event: 'SLA_POLICY_UPDATED',
          userId: user.id,
          resourceType: 'Space',
          resourceId: space.id,
          details: `Updated SLA thresholds for space ${space.name} (Urgent: ${updatedPolicy.urgentHours}h, High: ${updatedPolicy.highHours}h, Normal: ${updatedPolicy.normalHours}h, Low: ${updatedPolicy.lowHours}h)`,
        },
      });
    } catch (auditErr) {
      console.error('Failed to create audit log for SLA update:', auditErr);
    }

    return NextResponse.json({
      success: true,
      policy: updatedPolicy,
    });
  } catch (error) {
    console.error('Error updating SLA policy:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Internal server error while updating SLA policy.',
      },
      { status: 500 }
    );
  }
}
