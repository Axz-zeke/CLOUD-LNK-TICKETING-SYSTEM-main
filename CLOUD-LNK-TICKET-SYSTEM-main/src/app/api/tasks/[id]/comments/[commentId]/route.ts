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

// DELETE /api/tasks/[id]/comments/[commentId]
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; commentId: string }> }
) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id: taskId, commentId } = await context.params;
    const { user } = auth;
    const ipAddress = request.headers.get('x-forwarded-for') || '127.0.0.1';

    // Layer 2 Access Guard
    await assertTaskAccess(taskId, user, { ipAddress, db: prisma });

    const comment = await prisma.taskComment.findFirst({
      where: { id: commentId, taskId },
    });

    if (!comment) {
      return NextResponse.json({ error: 'Comment not found.' }, { status: 404 });
    }

    // Fetch full task details for permission checks
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

    // Authorization Check:
    // Allow if requesting user is:
    // 1. Comment author
    // 2. Ticket creator
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

    const isAuthor = comment.authorId === user.id;
    const isCreator = task.createdById === user.id;
    const isSuperAdmin = user.globalRole === 'SUPERADMIN';

    if (!isSuperAdmin && !isAuthor && !isCreator && !isDeptHead && !isDeptAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: You do not have permission to delete this comment.' },
        { status: 403 }
      );
    }

    // Parse attachments from comment to perform cleanup
    let commentAttachments: any[] = [];
    if (comment.attachmentsJson) {
      try {
        commentAttachments = JSON.parse(comment.attachmentsJson);
      } catch {}
    }

    const deletedAttachmentIds: string[] = [];
    let attachmentsToDelete: any[] = [];

    if (Array.isArray(commentAttachments) && commentAttachments.length > 0) {
      const orClauses = commentAttachments.flatMap((att) => [
        ...(att.id ? [{ id: att.id }] : []),
        ...(att.fileUrl ? [{ fileUrl: att.fileUrl }] : []),
        ...(att.fileName ? [{ fileName: att.fileName }] : []),
      ]);

      if (orClauses.length > 0) {
        attachmentsToDelete = await prisma.taskAttachment.findMany({
          where: {
            taskId,
            OR: orClauses,
          },
        });
      }
    }

    const attachmentIds = attachmentsToDelete.map((a) => a.id);
    deletedAttachmentIds.push(...attachmentIds);

    // Fast DB transaction with DB_TRANSACTION_OPTIONS
    await withDbRetry(async () => {
      return prisma.$transaction(async (tx) => {
        if (attachmentIds.length > 0) {
          await tx.taskAttachment.deleteMany({
            where: { id: { in: attachmentIds } },
          });

          await tx.taskHistory.createMany({
            data: attachmentsToDelete.map((att) => ({
              taskId,
              actorId: user.id,
              actionType: 'ATTACHMENT_DELETE',
              fromSpaceId: task.spaceId,
              toSpaceId: task.spaceId,
              notes: `Removed attachment via comment deletion: ${att.fileName}`,
            })),
          });
        }

        await tx.taskComment.delete({
          where: { id: commentId },
        });
      }, DB_TRANSACTION_OPTIONS);
    });

    // Cleanup Google Drive & physical files asynchronously in background (0ms DB delay)
    if (attachmentsToDelete.length > 0) {
      void (async () => {
        for (const att of attachmentsToDelete) {
          const driveFileId = extractDriveFileId(att.fileUrl);
          if (driveFileId) {
            try {
              await deleteFromGoogleDrive(driveFileId);
            } catch (driveErr) {
              console.warn(`Failed to delete Drive file ${driveFileId}:`, driveErr);
            }
          }
          try {
            const relativePath = att.fileUrl.startsWith('/') ? att.fileUrl.slice(1) : att.fileUrl;
            const fullPath = path.join(process.cwd(), 'public', relativePath);
            await fs.unlink(fullPath);
          } catch (fsErr: any) {
            if (fsErr?.code !== 'ENOENT') {
              console.warn(`Failed to unlink file ${att.fileUrl}:`, fsErr);
            }
          }
        }
      })();
    }

    // Real-Time LAN Broadcast: Broadcast COMMENT_DELETED
    try {
      const extraUsers: string[] = [];
      if (task.createdById && task.createdById !== user.id) extraUsers.push(task.createdById);
      await broadcastToSpaceStaff(
        task.spaceId,
        {
          type: 'COMMENT_DELETED',
          taskId,
          spaceId: task.spaceId,
          commentId,
          deletedAttachmentIds,
          timestamp: new Date().toISOString(),
        },
        extraUsers
      );
    } catch (sseErr) {
      console.warn('Failed to broadcast comment deletion:', sseErr);
    }

    invalidateCachePrefix('tasks:');
    invalidateCachePrefix(`task:detail:${taskId}`);

    return NextResponse.json({
      success: true,
      deletedCommentId: commentId,
      deletedAttachmentIds,
    });
  } catch (error: any) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error?.message || 'Failed to delete comment.' },
      { status: error?.status || 500 }
    );
  }
}
