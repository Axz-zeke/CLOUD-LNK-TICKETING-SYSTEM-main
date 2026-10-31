import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import { prisma, withDbRetry, DB_TRANSACTION_OPTIONS } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { assertTaskAccess } from '@/lib/security/query-guard';
import { ForbiddenError } from '@/lib/security/rbac';
import { broadcastToSpaceStaff } from '@/lib/sse-broker';
import { isGoogleDriveStorage, uploadToGoogleDrive, setCachedDriveFile } from '@/lib/google-drive-bridge';
import { invalidateCachePrefix } from '@/lib/server-cache';
import { appendAttachmentsToMasterStore } from '@/lib/task-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

const ALLOWED_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg',
  'pdf', 'txt', 'log', 'csv', 'json', 'xml',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'zip', 'rar', '7z', 'tar', 'gz',
  'mp4', 'mov', 'avi', 'mkv', 'webm',
  'dwg', 'dxf', 'psd', 'ai',
]);

function isAllowedFileType(fileName: string, mimeType?: string): boolean {
  if (mimeType) {
    if (
      mimeType.startsWith('image/') ||
      mimeType.startsWith('video/') ||
      mimeType.startsWith('text/')
    ) {
      return true;
    }
    const lowerMime = mimeType.toLowerCase();
    if (
      lowerMime === 'application/pdf' ||
      lowerMime.includes('zip') ||
      lowerMime.includes('rar') ||
      lowerMime.includes('7z') ||
      lowerMime.includes('tar') ||
      lowerMime.includes('word') ||
      lowerMime.includes('excel') ||
      lowerMime.includes('sheet') ||
      lowerMime.includes('presentation') ||
      lowerMime.includes('powerpoint') ||
      lowerMime.includes('json') ||
      lowerMime.includes('xml')
    ) {
      return true;
    }
  }
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

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

// GET /api/tasks/[id]/attachments
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id: taskId } = await context.params;
    const { user } = auth;
    const ipAddress = request.headers.get('x-forwarded-for') || '127.0.0.1';

    await assertTaskAccess(taskId, user, { ipAddress, db: prisma });

    const attachments = await prisma.taskAttachment.findMany({
      where: { taskId },
      include: {
        uploadedBy: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ attachments });
  } catch (error: any) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch attachments.' },
      { status: error?.status || 500 }
    );
  }
}

// POST /api/tasks/[id]/attachments
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id: taskId } = await context.params;
    const { user } = auth;
    const ipAddress = request.headers.get('x-forwarded-for') || '127.0.0.1';

    const task = await assertTaskAccess(taskId, user, { ipAddress, db: prisma });

    const contentType = request.headers.get('content-type') || '';
    let uploadedFileData: Array<{
      rawName: string;
      fileUrl: string;
      fileType: string;
      fileSize: number;
    }> = [];

    if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => ({}));
      const rawStaged = Array.isArray(body.stagedAttachments)
        ? body.stagedAttachments
        : body.attachment
        ? [body.attachment]
        : [];

      for (const att of rawStaged) {
        if (att && (att.fileName || att.filename) && (att.fileUrl || att.filepath)) {
          const rawName = String(att.fileName || att.filename).trim();
          const fileUrl = String(att.fileUrl || att.filepath).trim();
          const fileType = att.fileType || att.mimeType || 'application/octet-stream';
          const fileSize = Math.max(0, Math.round(Number(att.fileSize ?? att.size ?? 0)));

          if (fileSize > MAX_FILE_SIZE) {
            return NextResponse.json(
              { error: `File "${rawName}" exceeds the 100MB limit (${(fileSize / (1024 * 1024)).toFixed(1)}MB).` },
              { status: 400 }
            );
          }

          if (!isAllowedFileType(rawName, fileType)) {
            return NextResponse.json(
              { error: `Unsupported file type (${fileType}) for "${rawName}". Allowed: images, videos, documents, CAD, and archives.` },
              { status: 400 }
            );
          }

          uploadedFileData.push({
            rawName,
            fileUrl,
            fileType,
            fileSize,
          });
        }
      }

      if (uploadedFileData.length === 0) {
        return NextResponse.json({ error: 'No valid stagedAttachments provided in JSON payload.' }, { status: 400 });
      }
    } else {
      const formData = await request.formData();
      const rawFiles = [
        ...formData.getAll('files'),
        ...formData.getAll('file'),
      ].filter((f): f is File => f instanceof File && f.size > 0);

      if (rawFiles.length === 0) {
        return NextResponse.json({ error: 'No file provided in form data.' }, { status: 400 });
      }

      for (const file of rawFiles) {
        if (file.size > MAX_FILE_SIZE) {
          return NextResponse.json(
            { error: `File "${file.name}" exceeds the 100MB limit (${(file.size / (1024 * 1024)).toFixed(1)}MB).` },
            { status: 400 }
          );
        }

        const fileType = file.type || 'application/octet-stream';
        if (!isAllowedFileType(file.name, fileType)) {
          return NextResponse.json(
            { error: `Unsupported file type (${fileType}) for "${file.name}". Allowed: images, videos, documents, CAD, and archives.` },
            { status: 400 }
          );
        }
      }

      const isDrive = isGoogleDriveStorage();
      const d = new Date();
      const subFolder = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      // Upload all files concurrently via Promise.all
      uploadedFileData = await Promise.all(
        rawFiles.map(async (file) => {
          const rawName = file.name || 'unnamed-attachment';
          const sanitizedName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
          const timestamp = Date.now();
          const savedFileName = `${timestamp}-${sanitizedName}`;
          const buffer = Buffer.from(await file.arrayBuffer());
          const fileType = file.type || 'application/octet-stream';

          let fileUrl = `/uploads/tasks/${taskId}/${savedFileName}`;

          if (isDrive) {
            const driveUpload = await uploadToGoogleDrive({
              target: 'ATTACHMENTS',
              fileName: savedFileName,
              mimeType: fileType,
              buffer,
              subFolder,
            });
            fileUrl = `/api/attachments/drive/${driveUpload.fileId}?name=${encodeURIComponent(rawName)}`;

            // Immediately register in fast memory cache for sub-millisecond drawer preview loading
            setCachedDriveFile(driveUpload.fileId, {
              buffer,
              mimeType: fileType,
              fileName: rawName,
            });

            // Save local fallback copy if writable
            try {
              const taskUploadsDir = path.join(process.cwd(), 'public', 'uploads', 'tasks', taskId);
              await fs.mkdir(taskUploadsDir, { recursive: true });
              await fs.writeFile(path.join(taskUploadsDir, savedFileName), buffer);
            } catch {}
          } else {
            const taskUploadsDir = path.join(process.cwd(), 'public', 'uploads', 'tasks', taskId);
            await fs.mkdir(taskUploadsDir, { recursive: true });
            await fs.writeFile(path.join(taskUploadsDir, savedFileName), buffer);

            // Fast memory cache for instant drawer serving
            setCachedDriveFile(savedFileName, {
              buffer,
              mimeType: fileType,
              fileName: rawName,
            });
          }

          return {
            rawName,
            fileUrl,
            fileType,
            fileSize: file.size,
          };
        })
      );
    }

    // Save all attachment records in single database transaction
    const { createdAttachments, activityComments } = await withDbRetry(async () => {
      return prisma.$transaction(async (tx) => {
        const records = [];
        const comments = [];

        for (const item of uploadedFileData) {
          const record = await tx.taskAttachment.create({
            data: {
              taskId,
              fileName: item.rawName,
              fileUrl: item.fileUrl,
              fileType: item.fileType,
              fileSize: item.fileSize,
              uploadedById: user.id,
            },
            include: {
              uploadedBy: {
                select: {
                  id: true,
                  name: true,
                  username: true,
                },
              },
            },
          });

          await tx.taskHistory.create({
            data: {
              taskId,
              actorId: user.id,
              actionType: 'ATTACHMENT_UPLOAD',
              fromSpaceId: task.spaceId,
              toSpaceId: task.spaceId,
              notes: `Uploaded attachment: ${item.rawName} (${(item.fileSize / 1024).toFixed(1)} KB)`,
            },
          });

          const commentAttachment = [
            {
              id: record.id,
              fileName: item.rawName,
              fileUrl: item.fileUrl,
              fileType: item.fileType,
              fileSize: item.fileSize,
            },
          ];

          const activityComment = await tx.taskComment.create({
            data: {
              taskId,
              authorId: user.id,
              content: `Uploaded attachment: ${item.rawName}`,
              isInternal: false,
              attachmentsJson: JSON.stringify(commentAttachment),
            },
            include: {
              author: {
                select: { id: true, username: true, name: true, email: true, globalRole: true },
              },
            },
          });

          records.push(record);
          comments.push(activityComment);
        }

        return { createdAttachments: records, activityComments: comments };
      }, DB_TRANSACTION_OPTIONS);
    });

    // Real-Time LAN Broadcast: Broadcast COMMENT_CREATED for right-pane comments feed
    try {
      const extraUsers: string[] = [];
      if (task.createdById && task.createdById !== user.id) extraUsers.push(task.createdById);
      const taskAssignee = (task as any).assigneeId;
      if (taskAssignee && taskAssignee !== user.id) extraUsers.push(taskAssignee);

      for (const comment of activityComments) {
        await broadcastToSpaceStaff(
          task.spaceId,
          {
            type: 'COMMENT_CREATED',
            taskId,
            spaceId: task.spaceId,
            comment,
            isInternal: false,
            timestamp: new Date().toISOString(),
          },
          extraUsers
        );
      }
    } catch (sseErr) {
      console.warn('Failed to broadcast comment creation on attachment upload:', sseErr);
    }

    // In-place hydration of server master task store & invalidation of detail cache
    appendAttachmentsToMasterStore(taskId, createdAttachments);
    invalidateCachePrefix('tasks:');
    invalidateCachePrefix(`task:detail:${taskId}`);

    return NextResponse.json({
      success: true,
      attachment: createdAttachments[0],
      attachments: createdAttachments,
      comment: activityComments[0],
      comments: activityComments,
    }, { status: 201 });
  } catch (error: any) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error?.message || 'Failed to upload attachment.' },
      { status: error?.status || 500 }
    );
  }
}
