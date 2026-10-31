import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';

const VALID_FIELD_TYPES = ['TEXT', 'NUMBER', 'CURRENCY', 'SELECT', 'DATE'] as const;

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

/**
 * GET /api/spaces/[id]/custom-fields
 * Returns configured custom field definitions for the specified space.
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

    const { id: spaceId } = await context.params;
    const url = new URL(request.url);
    const filterListId = url.searchParams.get('listId');

    const whereClause: any = { spaceId };
    if (filterListId && filterListId !== 'ALL') {
      whereClause.OR = [
        { listId: null },
        { listId: filterListId },
      ];
    }

    const fields = await prisma.customFieldDefinition.findMany({
      where: whereClause,
      include: {
        list: {
          select: { id: true, name: true },
        },
      },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });

    return NextResponse.json({ fields });
  } catch (error) {
    console.error('Failed to get custom fields:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve custom fields.' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/spaces/[id]/custom-fields
 * Configures a new department custom field (Space Admin or Superadmin clearance required).
 */
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

    const hasClearance = await verifySpaceAdminClearance(spaceId, user.id, user.globalRole);
    if (!hasClearance) {
      return NextResponse.json(
        { error: 'Forbidden: Department Admin or Superadmin clearance required.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const name = String(body.name || '').trim();
    const fieldType = String(body.fieldType || '').toUpperCase();
    const isRequired = Boolean(body.isRequired);
    const order = typeof body.order === 'number' ? body.order : 0;
    const rawListId = body.listId;
    const listId = (!rawListId || rawListId === 'ALL') ? null : String(rawListId).trim();

    if (!name) {
      return NextResponse.json({ error: 'Field name is required.' }, { status: 400 });
    }

    if (!VALID_FIELD_TYPES.includes(fieldType as any)) {
      return NextResponse.json(
        { error: `Invalid field type. Allowed: ${VALID_FIELD_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    if (listId) {
      const listExists = await prisma.list.findFirst({
        where: { id: listId, spaceId },
      });
      if (!listExists) {
        return NextResponse.json(
          { error: 'Specified Queue List was not found in this department.' },
          { status: 400 }
        );
      }
    }

    let serializedOptions: string | null = null;
    if (fieldType === 'SELECT') {
      if (Array.isArray(body.options)) {
        serializedOptions = JSON.stringify(body.options.map(String).map((s: string) => s.trim()).filter(Boolean));
      } else if (typeof body.options === 'string') {
        const parsed = body.options
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean);
        serializedOptions = JSON.stringify(parsed);
      } else {
        serializedOptions = JSON.stringify([]);
      }
    }

    // Check duplicate name in space
    const existing = await prisma.customFieldDefinition.findUnique({
      where: {
        spaceId_name: { spaceId, name },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: `A field named "${name}" already exists in this department.` },
        { status: 409 }
      );
    }

    const field = await prisma.customFieldDefinition.create({
      data: {
        spaceId,
        listId,
        name,
        fieldType,
        options: serializedOptions,
        isRequired,
        order,
      },
      include: {
        list: {
          select: { id: true, name: true },
        },
      },
    });

    return NextResponse.json({ success: true, field }, { status: 201 });
  } catch (error) {
    console.error('Failed to create custom field:', error);
    return NextResponse.json(
      { error: 'Failed to create custom field definition.' },
      { status: 500 }
    );
  }
}
