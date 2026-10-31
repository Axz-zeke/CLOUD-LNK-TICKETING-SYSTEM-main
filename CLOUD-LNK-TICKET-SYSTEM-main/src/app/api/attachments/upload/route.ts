import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { assertTaskAccess } from '@/lib/security/query-guard';
import { ForbiddenError } from '@/lib/security/rbac';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { isGoogleDriveStorage, uploadToGoogleDrive } from '@/lib/google-drive-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_ATTACHMENT_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB
const ALLOWED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
  '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt',
  '.txt', '.csv', '.log', '.json', '.xml',
  '.zip', '.rar', '.7z', '.tar', '.gz',
  '.mp4', '.mov', '.avi', '.mkv', '.webm',
  '.dwg', '.dxf', '.psd', '.ai',
]);

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

// POST /api/attachments/upload - Multipart local file upload with traversal protection
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user } = auth;
    const ipAddress = request.headers.get('x-forwarded-for') || '127.0.0.1';

    // Rate limit: max 15 uploads per minute per user
    const uploadRate = checkRateLimit(`upload:${user.id}`, {
      intervalMs: 60 * 1000,
      maxRequests: 15,
    });
    if (!uploadRate.success) {
      return NextResponse.json(
        { error: `Upload rate limit reached. Please wait ${uploadRate.retryAfterSeconds} seconds.` },
        { status: 429, headers: { 'Retry-After': String(uploadRate.retryAfterSeconds) } }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const taskId = formData.get('taskId') as string | null;

    if (!file || !taskId) {
      return NextResponse.json(
        { error: 'Both file and taskId are required in multipart/form-data.' },
        { status: 400 }
      );
    }

    // Size limit enforcement
    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      return NextResponse.json(
        { error: 'PAYLOAD_TOO_LARGE', message: 'Attachment file size exceeds the 100MB limit.' },
        { status: 413 }
      );
    }

    // Extension whitelist enforcement
    const originalName = file.name || 'attachment.dat';
    const ext = path.extname(originalName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        {
          error: 'UNSUPPORTED_MEDIA_TYPE',
          message: `File extension '${ext}' is not permitted for upload. Allowed extensions: ${Array.from(ALLOWED_EXTENSIONS).join(', ')}`,
        },
        { status: 415 }
      );
    }

    // Layer 2 Access Assertion: User must have clearance for this task's space
    await assertTaskAccess(taskId, user, { ipAddress, db: prisma });

    // Validate and sanitize filename
    const sanitizedBase = path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const randomToken = crypto.randomBytes(6).toString('hex');
    const diskFilename = `att_${Date.now()}_${randomToken}_${sanitizedBase}`;

    // Target directory resolution and path traversal defense
    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const targetPath = path.resolve(uploadsDir, diskFilename);

    // Defense-in-depth: Ensure targetPath is strictly inside uploadsDir
    if (!targetPath.startsWith(uploadsDir + path.sep)) {
      return NextResponse.json(
        { error: 'Security violation: Invalid path resolution.' },
        { status: 400 }
      );
    }

    // Write file buffer to local disk
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    let storedFilePath = diskFilename;

    if (isGoogleDriveStorage()) {
      const d = new Date();
      const subFolder = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const driveUpload = await uploadToGoogleDrive({
        target: 'ATTACHMENTS',
        fileName: diskFilename,
        mimeType: file.type || 'application/octet-stream',
        buffer: fileBuffer,
        subFolder,
      });
      storedFilePath = `/api/attachments/drive/${driveUpload.fileId}?name=${encodeURIComponent(originalName)}`;

      try {
        await fs.promises.writeFile(targetPath, fileBuffer);
      } catch {}
    } else {
      await fs.promises.writeFile(targetPath, fileBuffer);
    }

    // Persist attachment metadata
    const attachment = await prisma.attachment.create({
      data: {
        taskId,
        uploaderId: user.id,
        filename: originalName,
        filepath: storedFilePath,
        size: fileBuffer.length,
        mimeType: file.type || 'application/octet-stream',
      },
      include: {
        uploader: {
          select: { id: true, username: true, name: true, email: true },
        },
      },
    });

    return NextResponse.json({ success: true, attachment }, { status: 201 });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    console.error('Failed to upload attachment:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error uploading file' },
      { status: 500 }
    );
  }
}
