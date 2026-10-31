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

async function verifySpaceAdminClearance(spaceId: string, userId: string, globalRole: string) {
  if (globalRole === 'SUPERADMIN') return true;

  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { departmentHeadId: true },
  });
  if (space?.departmentHeadId === userId) return true;

  const membership = await prisma.spaceMember.findUnique({
    where: {
      spaceId_userId: { spaceId, userId },
    },
    select: { role: true },
  });

  return membership?.role === 'ADMIN';
}

// GET /api/spaces/[id]/templates
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id: spaceId } = await context.params;

    const templates = await prisma.ticketTemplate.findMany({
      where: { spaceId },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({ templates });
  } catch (error: any) {
    console.error('Failed to get ticket templates:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve ticket templates.' },
      { status: 500 }
    );
  }
}

// POST /api/spaces/[id]/templates
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id: spaceId } = await context.params;
    const { user } = auth;

    const isAuthorized = await verifySpaceAdminClearance(spaceId, user.id, user.globalRole);
    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Forbidden: Admin clearance required to configure ticket templates.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { name, titlePrefix, defaultPriority, descriptionTemplate, defaultChecklist } = body;

    if (!name || !descriptionTemplate) {
      return NextResponse.json(
        { error: 'Template name and description template are required.' },
        { status: 400 }
      );
    }

    let checklistStr = null;
    if (Array.isArray(defaultChecklist)) {
      checklistStr = JSON.stringify(defaultChecklist);
    } else if (typeof defaultChecklist === 'string') {
      checklistStr = defaultChecklist;
    }

    const template = await prisma.ticketTemplate.create({
      data: {
        spaceId,
        name: name.trim(),
        titlePrefix: titlePrefix?.trim() || null,
        defaultPriority: defaultPriority || 'NORMAL',
        descriptionTemplate: descriptionTemplate.trim(),
        defaultChecklist: checklistStr,
      },
    });

    return NextResponse.json({ template }, { status: 201 });
  } catch (error: any) {
    console.error('Failed to create ticket template:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to create ticket template.' },
      { status: 500 }
    );
  }
}
