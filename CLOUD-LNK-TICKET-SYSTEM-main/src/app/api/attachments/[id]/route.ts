import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { prisma } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { assertTaskAccess } from '@/lib/security/query-guard';
import { ForbiddenError } from '@/lib/security/rbac';
import { downloadFromGoogleDrive, extractDriveFileId } from '@/lib/google-drive-bridge';

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

// GET /api/attachments/[id] - Stream attachment with Layer 2 space clearance verification
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id: attachmentId } = await context.params;
    const { user } = auth;
    const ipAddress = request.headers.get('x-forwarded-for') || '127.0.0.1';

    // 1. Fetch attachment record
    const attachment = await prisma.attachment.findUnique({
      where: { id: attachmentId },
      include: {
        task: {
          select: {
            id: true,
            taskKey: true,
            spaceId: true,
            createdById: true,
          },
        },
      },
    });

    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found.' }, { status: 404 });
    }

    // 2. LAYER 2 ASSERTION: Verify user has clearance to the parent ticket's space
    // Throws ForbiddenError and records AuditLog if user is a cross-department agent or unauthorized requester
    await assertTaskAccess(attachment.taskId, user, { ipAddress, db: prisma });

    // 3. Check if file is stored in Google Drive
    const driveFileId = extractDriveFileId(attachment.filepath);
    if (driveFileId) {
      const driveFile = await downloadFromGoogleDrive(driveFileId);
      const headers = new Headers();
      headers.set('Content-Type', driveFile.mimeType || attachment.mimeType || 'application/octet-stream');
      headers.set(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(attachment.filename)}"`
      );
      headers.set('Content-Length', driveFile.buffer.length.toString());
      headers.set('Cache-Control', 'private, max-age=86400');
      return new NextResponse(new Uint8Array(driveFile.buffer), {
        status: 200,
        headers,
      });
    }

    // Otherwise resolve disk filepath safely against ./uploads
    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    const safeFilename = path.basename(attachment.filepath);
    const filePath = path.resolve(uploadsDir, safeFilename);

    if (!filePath.startsWith(uploadsDir + path.sep)) {
      return NextResponse.json({ error: 'Security violation: Traversal attempt blocked.' }, { status: 400 });
    }

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Attachment file not found on local storage.' }, { status: 404 });
    }

    // 4. Read file bytes and stream response
    const fileBuffer = await fs.promises.readFile(filePath);

    const headers = new Headers();
    headers.set('Content-Type', attachment.mimeType || 'application/octet-stream');
    headers.set(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(attachment.filename)}"`
    );
    headers.set('Content-Length', fileBuffer.length.toString());
    headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');

    return new NextResponse(fileBuffer, {
      status: 200,
      headers,
    });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    console.error('Failed to retrieve attachment:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error retrieving attachment' },
      { status: 500 }
    );
  }
}
