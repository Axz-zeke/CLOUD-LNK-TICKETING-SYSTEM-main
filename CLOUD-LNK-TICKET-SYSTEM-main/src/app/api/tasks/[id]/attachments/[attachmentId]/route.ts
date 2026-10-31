import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import { prisma, withDbRetry, DB_TRANSACTION_OPTIONS } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { assertTaskAccess } from '@/lib/security/query-guard';
import { ForbiddenError } from '@/lib/security/rbac';
import { broadcastToSpaceStaff } from '@/lib/sse-broker';
import { deleteFromGoogleDrive, extractDriveFileId } from '@/lib/google-drive-bridge';
import { invalidateCachePrefix } from '@/lib/server-cache';

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

// DELETE /api/tasks/[id]/attachments/[attachmentId]
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; attachmentId: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id: taskId, attachmentId } = await context.params;
    const { user } = auth;
    const ipAddress = request.headers.get('x-forwarded-for') || '127.0.0.1';

    // Layer 2 Access Guard
    await assertTaskAccess(taskId, user, { ipAddress, db: prisma });

    // Fetch full task details to resolve department scopes & roles
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        spaceId: true,
        originSpaceId: true,
        createdById: true,
        space: {
          select: { id: true, name: true, departmentHeadId: true },
        },
        originSpace: {
          select: { id: true, name: true, departmentHeadId: true },
        },
        history: {
          where: { actionType: 'HANDOFF_TRANSFER' },
          select: { fromSpaceId: true, toSpaceId: true },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
    }

    // Locate attachment in TaskAttachment or legacy Attachment table
    let attachment: {
      id: string;
      taskId: string;
      fileName: string;
      fileUrl: string;
      fileType: string;
      fileSize: number;
      uploadedById: string;
    } | null = null;
    let isLegacy = false;

    const modernAttachment = await prisma.taskAttachment.findFirst({
      where: { id: attachmentId, taskId },
    });

    if (modernAttachment) {
      attachment = modernAttachment;
    } else {
      const legacyAttachment = await prisma.attachment.findFirst({
        where: { id: attachmentId, taskId },
      });
      if (legacyAttachment) {
        attachment = {
          id: legacyAttachment.id,
          taskId: legacyAttachment.taskId,
          fileName: legacyAttachment.filename,
          fileUrl: legacyAttachment.filepath,
          fileType: legacyAttachment.mimeType,
          fileSize: legacyAttachment.size,
          uploadedById: legacyAttachment.uploaderId,
        };
        isLegacy = true;
      }
    }

    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found.' }, { status: 404 });
    }

    // Authorization Check:
    // Allow if requesting user is:
    // 1. The uploader
    // 2. The ticket creator
    // 3. Dept lead/admin of active or originating department
    // 4. SUPERADMIN
    const authorizedSpaceIds = new Set<string>();
    if (task.spaceId) authorizedSpaceIds.add(task.spaceId);
    if (task.originSpaceId) authorizedSpaceIds.add(task.originSpaceId);
    for (const h of task.history) {
      if (h.fromSpaceId) authorizedSpaceIds.add(h.fromSpaceId);
      if (h.toSpaceId) authorizedSpaceIds.add(h.toSpaceId);
    }

    const isDeptHead =
      task.space?.departmentHeadId === user.id ||
      task.originSpace?.departmentHeadId === user.id;

    const isDeptAdmin = Boolean(
      await prisma.spaceMember.findFirst({
        where: {
          spaceId: { in: Array.from(authorizedSpaceIds) },
          userId: user.id,
          role: 'ADMIN',
        },
        select: { id: true },
      })
    );

    const isUploader = attachment.uploadedById === user.id;
    const isCreator = task.createdById === user.id;
    const isSuperAdmin = user.globalRole === 'SUPERADMIN';

    if (!isSuperAdmin && !isUploader && !isCreator && !isDeptHead && !isDeptAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: You do not have permission to delete this attachment.' },
        { status: 403 }
      );
    }

    // Attempt file removal from Google Drive if stored in cloud
    const driveFileId = extractDriveFileId(attachment.fileUrl);
    if (driveFileId) {
      try {
        await deleteFromGoogleDrive(driveFileId);
      } catch (driveErr) {
        console.warn(`[Attachment Cleanup] Failed to delete file ${driveFileId} from Google Drive:`, driveErr);
      }
    }

    // Attempt physical file removal from local storage cache
    try {
      const relativePath = attachment.fileUrl.startsWith('/')
        ? attachment.fileUrl.slice(1)
        : attachment.fileUrl;
      const fullPath = path.join(process.cwd(), 'public', relativePath);
      await fs.unlink(fullPath);
    } catch (fsError: any) {
      if (fsError?.code !== 'ENOENT') {
        console.warn(`[Attachment Cleanup] Failed to unlink file ${attachment.fileUrl}:`, fsError);
      }
    }

    const { deletedCommentIds, updatedComments } = await withDbRetry(async () => {
      return prisma.$transaction(async (tx) => {
        // 1. Delete attachment database record
        if (isLegacy) {
          await tx.attachment.delete({ where: { id: attachmentId } });
        } else {
          await tx.taskAttachment.delete({ where: { id: attachmentId } });
        }

        // 2. Inspect all comments on the task referencing this attachment in attachmentsJson
        const deletedCommentIdsList: string[] = [];
        const updatedCommentsList: any[] = [];

        const comments = await tx.taskComment.findMany({
          where: {
            taskId,
            attachmentsJson: { not: null },
          },
        });

        for (const c of comments) {
          if (!c.attachmentsJson) continue;
          let attList: any[] = [];
          try {
            attList = JSON.parse(c.attachmentsJson);
          } catch {
            continue;
          }
          if (!Array.isArray(attList)) continue;

          // Filter out the deleted attachment
          const remaining = attList.filter((a) => {
            const isMatch =
              (Boolean(a.id) && Boolean(attachment?.id) && a.id === attachment?.id) ||
              (Boolean(a.fileUrl) && Boolean(attachment?.fileUrl) && a.fileUrl === attachment?.fileUrl) ||
              (!a.id && !a.fileUrl && Boolean(a.fileName) && a.fileName === attachment?.fileName);
            return !isMatch;
          });

          if (remaining.length !== attList.length) {
            const trimmed = c.content.trim();
            const isFileOnly =
              trimmed.startsWith('Attached ') ||
              trimmed.startsWith('Uploaded attachment:') ||
              trimmed === '' ||
              trimmed === `Attached 1 file: ${attachment.fileName}` ||
              trimmed === `Uploaded attachment: ${attachment.fileName}`;

            // Smart Comment Cleanup:
            // If the comment was a file-only comment and now has 0 remaining attachments,
            // automatically delete the comment record so no empty shell comment remains.
            if (remaining.length === 0 && isFileOnly) {
              await tx.taskComment.delete({ where: { id: c.id } });
              deletedCommentIdsList.push(c.id);
            } else {
              // Comment has other files or custom text: update attachmentsJson
              const updated = await tx.taskComment.update({
                where: { id: c.id },
                data: {
                  attachmentsJson: remaining.length > 0 ? JSON.stringify(remaining) : null,
                },
                include: {
                  author: {
                    select: { id: true, username: true, name: true, email: true, globalRole: true },
                  },
                },
              });
              updatedCommentsList.push({
                ...updated,
                attachments: remaining,
              });
            }
          }
        }

        // 3. Log an audit entry in TaskHistory
        await tx.taskHistory.create({
          data: {
            taskId,
            actorId: user.id,
            actionType: 'ATTACHMENT_DELETE',
            fromSpaceId: task.spaceId,
            toSpaceId: task.spaceId,
            notes: `Removed attachment: ${attachment.fileName}`,
          },
        });

        return {
          deletedCommentIds: deletedCommentIdsList,
          updatedComments: updatedCommentsList,
        };
      }, DB_TRANSACTION_OPTIONS);
    });

    // Real-Time LAN Pipeline: Broadcast ATTACHMENT_DELETED
    try {
      const extraUsers: string[] = [];
      if (task.createdById && task.createdById !== user.id) extraUsers.push(task.createdById);
      await broadcastToSpaceStaff(
        task.spaceId,
        {
          type: 'ATTACHMENT_DELETED',
          taskId,
          spaceId: task.spaceId,
          attachmentId,
          deletedCommentIds,
          timestamp: new Date().toISOString(),
        },
        extraUsers
      );
    } catch (sseErr) {
      console.warn('Failed to broadcast attachment deletion:', sseErr);
    }

    invalidateCachePrefix('tasks:');
    invalidateCachePrefix(`task:detail:${taskId}`);

    return NextResponse.json({
      success: true,
      deletedAttachmentId: attachmentId,
      deletedCommentIds,
      updatedComments,
    });
  } catch (error: any) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error?.message || 'Failed to delete attachment.' },
      { status: error?.status || 500 }
    );
  }
}
