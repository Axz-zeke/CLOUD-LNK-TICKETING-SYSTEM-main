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
 * PATCH /api/spaces/[id]/custom-fields/[fieldId]
 * Updates a department custom field definition.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; fieldId: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id: spaceId, fieldId } = await context.params;
    const { user } = auth;

    const hasClearance = await verifySpaceAdminClearance(spaceId, user.id, user.globalRole);
    if (!hasClearance) {
      return NextResponse.json(
        { error: 'Forbidden: Department Admin or Superadmin clearance required.' },
        { status: 403 }
      );
    }

    const existing = await prisma.customFieldDefinition.findUnique({
      where: { id: fieldId },
    });

    if (!existing || existing.spaceId !== spaceId) {
      return NextResponse.json({ error: 'Custom field not found.' }, { status: 404 });
    }

    const body = await request.json();
    const updateData: Record<string, any> = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) {
        return NextResponse.json({ error: 'Field name cannot be empty.' }, { status: 400 });
      }
      if (name !== existing.name) {
        const duplicate = await prisma.customFieldDefinition.findFirst({
          where: {
            spaceId,
            name,
            id: { not: fieldId },
          },
        });
        if (duplicate) {
          return NextResponse.json(
            { error: `A field named "${name}" already exists in this department.` },
            { status: 409 }
          );
        }
      }
      updateData.name = name;
    }

    if (body.listId !== undefined) {
      const rawListId = body.listId;
      if (!rawListId || rawListId === 'ALL') {
        updateData.listId = null;
      } else {
        const trimmedListId = String(rawListId).trim();
        const listExists = await prisma.list.findFirst({
          where: { id: trimmedListId, spaceId },
        });
        if (!listExists) {
          return NextResponse.json(
            { error: 'Specified Queue List was not found in this department.' },
            { status: 400 }
          );
        }
        updateData.listId = trimmedListId;
      }
    }

    if (body.fieldType !== undefined) {
      const fieldType = String(body.fieldType).toUpperCase();
      if (!VALID_FIELD_TYPES.includes(fieldType as any)) {
        return NextResponse.json(
          { error: `Invalid field type. Allowed: ${VALID_FIELD_TYPES.join(', ')}` },
          { status: 400 }
        );
      }
      updateData.fieldType = fieldType;
    }

    if (body.options !== undefined) {
      if (Array.isArray(body.options)) {
        updateData.options = JSON.stringify(body.options.map(String).map((s: string) => s.trim()).filter(Boolean));
      } else if (typeof body.options === 'string') {
        const parsed = body.options
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean);
        updateData.options = JSON.stringify(parsed);
      } else {
        updateData.options = null;
      }
    }

    if (body.isRequired !== undefined) {
      updateData.isRequired = Boolean(body.isRequired);
    }

    if (body.order !== undefined && typeof body.order === 'number') {
      updateData.order = body.order;
    }

    const updated = await prisma.customFieldDefinition.update({
      where: { id: fieldId },
      data: updateData,
      include: {
        list: {
          select: { id: true, name: true },
        },
      },
    });

    return NextResponse.json({ success: true, field: updated });
  } catch (error) {
    console.error('Failed to update custom field:', error);
    return NextResponse.json(
      { error: 'Failed to update custom field definition.' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/spaces/[id]/custom-fields/[fieldId]
 * Deletes a department custom field definition.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; fieldId: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id: spaceId, fieldId } = await context.params;
    const { user } = auth;

    const hasClearance = await verifySpaceAdminClearance(spaceId, user.id, user.globalRole);
    if (!hasClearance) {
      return NextResponse.json(
        { error: 'Forbidden: Department Admin or Superadmin clearance required.' },
        { status: 403 }
      );
    }

    const existing = await prisma.customFieldDefinition.findUnique({
      where: { id: fieldId },
    });

    if (!existing || existing.spaceId !== spaceId) {
      return NextResponse.json({ error: 'Custom field not found.' }, { status: 404 });
    }

    await prisma.customFieldDefinition.delete({
      where: { id: fieldId },
    });

    return NextResponse.json({ success: true, message: 'Custom field deleted successfully.' });
  } catch (error) {
    console.error('Failed to delete custom field:', error);
    return NextResponse.json(
      { error: 'Failed to delete custom field definition.' },
      { status: 500 }
    );
  }
}
