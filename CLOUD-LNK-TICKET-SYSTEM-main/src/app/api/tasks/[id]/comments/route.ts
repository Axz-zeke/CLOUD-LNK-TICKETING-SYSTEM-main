import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import { prisma, withDbRetry, DB_TRANSACTION_OPTIONS } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { assertTaskAccess, buildCommentQueryFilter } from '@/lib/security/query-guard';
import { ForbiddenError } from '@/lib/security/rbac';
import { createNotification, notifySpaceMembers } from '@/lib/notifications';
import { broadcastToSpaceStaff } from '@/lib/sse-broker';
import { isGoogleDriveStorage, uploadToGoogleDrive } from '@/lib/google-drive-bridge';
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

// GET /api/tasks/[id]/comments - Return comments with internal notes strictly hidden from requesters
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

    // Layer 2 Access Assertion: Requesters can only access their own tasks; staff must belong to the space
    const task = await assertTaskAccess(taskId, user, { ipAddress, db: prisma });

    // Check if user is staff member of this space or superadmin to view internal notes
    const isSpaceStaff =
      user.globalRole === 'SUPERADMIN' ||
      Boolean(
        await prisma.spaceMember.findUnique({
          where: {
            spaceId_userId: {
              spaceId: task.spaceId,
              userId: user.id,
            },
          },
        })
      ) ||
      Boolean(
        await prisma.space.findFirst({
          where: {
            id: task.spaceId,
            departmentHeadId: user.id,
          },
          select: { id: true },
        })
      );

    // Internal Notes Guard: Non-space staff receive isInternal: false comments only
    const comments = await prisma.taskComment.findMany({
      where: buildCommentQueryFilter(user, taskId, isSpaceStaff),
      include: {
        author: {
          select: { id: true, username: true, name: true, email: true, globalRole: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const formattedComments = comments.map((c) => {
      let parsedAttachments: any[] = [];
      if (c.attachmentsJson) {
        try {
          parsedAttachments = JSON.parse(c.attachmentsJson);
        } catch {}
      }
      return {
        ...c,
        attachments: parsedAttachments,
      };
    });

    return NextResponse.json({ comments: formattedComments });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    console.error('Failed to get comments:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error fetching comments' },
      { status: 500 }
    );
  }
}

// POST /api/tasks/[id]/comments - Post a new comment or internal note with optional attachments
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

    // Layer 2 Access Assertion
    const task = await assertTaskAccess(taskId, user, { ipAddress, db: prisma });

    let rawContent = '';
    let isInternal = false;
    const uploadedFiles: File[] = [];
    const preStagedFilesInfo: Array<{
      rawName: string;
      savedFileName: string;
      fileUrl: string;
      fileType: string;
      fileSize: number;
    }> = [];
    const commentAttachmentsList: Array<{
      id?: string;
      fileName: string;
      fileUrl: string;
      fileType: string;
      fileSize: number;
    }> = [];

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      rawContent = (formData.get('content') as string) || '';
      isInternal = formData.get('isInternal') === 'true';

      const fileEntries = formData.getAll('files') as File[];
      const singleFile = formData.get('file') as File | null;
      if (singleFile && typeof singleFile !== 'string') {
        fileEntries.push(singleFile);
      }
      for (const f of fileEntries) {
        if (f && typeof f !== 'string' && f.size > 0) {
          uploadedFiles.push(f);
        }
      }
    } else {
      const body = await request.json();
      rawContent = body.content || '';
      isInternal = Boolean(body.isInternal);
      if (Array.isArray(body.stagedAttachments)) {
        for (const att of body.stagedAttachments) {
          if (att && (att.fileUrl || att.filepath)) {
            const rawName = String(att.fileName || att.filename || 'attachment').trim();
            preStagedFilesInfo.push({
              rawName,
              savedFileName: rawName,
              fileUrl: String(att.fileUrl || att.filepath).trim(),
              fileType: att.fileType || att.mimeType || 'application/octet-stream',
              fileSize: Math.max(0, Math.round(Number(att.fileSize ?? att.size ?? 0))),
            });
          }
        }
      }
      if (Array.isArray(body.attachments)) {
        for (const att of body.attachments) {
          if (att && (att.fileUrl || att.filepath)) {
            if (!att.id) {
              const rawName = String(att.fileName || att.filename || 'attachment').trim();
              preStagedFilesInfo.push({
                rawName,
                savedFileName: rawName,
                fileUrl: String(att.fileUrl || att.filepath).trim(),
                fileType: att.fileType || att.mimeType || 'application/octet-stream',
                fileSize: Math.max(0, Math.round(Number(att.fileSize ?? att.size ?? 0))),
              });
            } else {
              commentAttachmentsList.push({
                id: att.id,
                fileName: att.fileName || att.filename || 'attachment',
                fileUrl: att.fileUrl || att.filepath,
                fileType: att.fileType || att.mimeType || 'application/octet-stream',
                fileSize: att.fileSize || att.size || 0,
              });
            }
          }
        }
      }
    }

    if (
      !rawContent.trim() &&
      uploadedFiles.length === 0 &&
      preStagedFilesInfo.length === 0 &&
      commentAttachmentsList.length === 0
    ) {
      return NextResponse.json({ error: 'Comment content or attachment is required.' }, { status: 400 });
    }

    // INTERNAL NOTE SECURITY ENFORCEMENT:
    // Requesters and cross-department users are strictly forbidden from authoring internal notes.
    if (Boolean(isInternal)) {
      const isSpaceStaff =
        user.globalRole === 'SUPERADMIN' ||
        Boolean(
          await prisma.spaceMember.findUnique({
            where: {
              spaceId_userId: {
                spaceId: task.spaceId,
                userId: user.id,
              },
            },
          })
        ) ||
        Boolean(
          await prisma.space.findFirst({
            where: {
              id: task.spaceId,
              departmentHeadId: user.id,
            },
            select: { id: true },
          })
        );

      if (!isSpaceStaff) {
        await prisma.auditLog.create({
          data: {
            event: 'UNAUTHORIZED_INTERNAL_NOTE_ATTEMPT',
            userId: user.id,
            resourceType: 'Task',
            resourceId: taskId,
            ipAddress,
            details: JSON.stringify({
              message: `User ${user.username} attempted to author an internal staff note without space staff clearance on task ${taskId}`,
              userRole: user.globalRole,
            }),
          },
        });

        return NextResponse.json(
          { error: 'HTTP 403 Forbidden: Clearance denied for authoring internal notes.' },
          { status: 403 }
        );
      }
    }

    // Process file uploads if present
    const taskUploadsDir = path.join(process.cwd(), 'public', 'uploads', 'tasks', taskId);
    if (uploadedFiles.length > 0) {
      await fs.mkdir(taskUploadsDir, { recursive: true });
    }

    const savedFilesInfo: Array<{
      rawName: string;
      savedFileName: string;
      fileUrl: string;
      fileType: string;
      fileSize: number;
    }> = [...preStagedFilesInfo];

    for (const file of uploadedFiles) {
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `File "${file.name}" exceeds the 100MB limit (${(file.size / (1024 * 1024)).toFixed(1)}MB).` },
          { status: 400 }
        );
      }

      const fileType = file.type || 'application/octet-stream';
      if (!isAllowedFileType(file.name, fileType)) {
        return NextResponse.json(
          { error: `Unsupported file type for "${file.name}": ${fileType}. Allowed: images, videos, documents, CAD, and archives.` },
          { status: 400 }
        );
      }

      const rawName = file.name || 'unnamed-attachment';
      const sanitizedName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const timestamp = Date.now() + Math.floor(Math.random() * 1000);
      const savedFileName = `${timestamp}-${sanitizedName}`;
      const buffer = Buffer.from(await file.arrayBuffer());

      let fileUrl = `/uploads/tasks/${taskId}/${savedFileName}`;

      if (isGoogleDriveStorage()) {
        const d = new Date();
        const subFolder = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const driveUpload = await uploadToGoogleDrive({
          target: 'ATTACHMENTS',
          fileName: savedFileName,
          mimeType: fileType,
          buffer,
          subFolder,
        });
        fileUrl = `/api/attachments/drive/${driveUpload.fileId}?name=${encodeURIComponent(rawName)}`;

        // Local fallback cache copy
        try {
          await fs.mkdir(taskUploadsDir, { recursive: true });
          await fs.writeFile(path.join(taskUploadsDir, savedFileName), buffer);
        } catch {}
      } else {
        await fs.mkdir(taskUploadsDir, { recursive: true });
        const targetFilePath = path.join(taskUploadsDir, savedFileName);
        await fs.writeFile(targetFilePath, buffer);
      }

      savedFilesInfo.push({
        rawName,
        savedFileName,
        fileUrl,
        fileType,
        fileSize: file.size,
      });
    }

    // Auto-generate caption if text content is empty
    let content = rawContent.trim();
    if (!content) {
      const allFileNames = [
        ...savedFilesInfo.map((f) => f.rawName),
        ...commentAttachmentsList.map((a) => a.fileName),
      ];
      if (allFileNames.length === 1) {
        content = `Attached 1 file: ${allFileNames[0]}`;
      } else if (allFileNames.length > 1) {
        content = `Attached ${allFileNames.length} files: ${allFileNames.join(', ')}`;
      }
    }

    // Atomic comment creation & attachment sync with concurrency retry guard
    const { comment, createdAttachments } = await withDbRetry(() =>
      prisma.$transaction(async (tx) => {
        const createdAttRecords: any[] = [];
        for (const fileInfo of savedFilesInfo) {
          const attRecord = await tx.taskAttachment.create({
            data: {
              taskId,
              fileName: fileInfo.rawName,
              fileUrl: fileInfo.fileUrl,
              fileType: fileInfo.fileType,
              fileSize: fileInfo.fileSize,
              uploadedById: user.id,
            },
            include: {
              uploadedBy: {
                select: { id: true, name: true, username: true },
              },
            },
          });
          createdAttRecords.push(attRecord);
          commentAttachmentsList.push({
            id: attRecord.id,
            fileName: fileInfo.rawName,
            fileUrl: fileInfo.fileUrl,
            fileType: fileInfo.fileType,
            fileSize: fileInfo.fileSize,
          });

          await tx.taskHistory.create({
            data: {
              taskId,
              actorId: user.id,
              actionType: 'ATTACHMENT_UPLOAD',
              fromSpaceId: task.spaceId,
              toSpaceId: task.spaceId,
              notes: `Uploaded attachment via comment: ${fileInfo.rawName} (${(fileInfo.fileSize / 1024).toFixed(1)} KB)`,
            },
          });
        }

        const createdComment = await tx.taskComment.create({
          data: {
            taskId,
            authorId: user.id,
            content,
            isInternal: Boolean(isInternal),
            attachmentsJson:
              commentAttachmentsList.length > 0 ? JSON.stringify(commentAttachmentsList) : null,
          },
          include: {
            author: {
              select: { id: true, username: true, name: true, email: true, globalRole: true },
            },
          },
        });

        // Connect commenter to task contributors
        await tx.task.update({
          where: { id: taskId },
          data: {
            contributors: {
              connect: { id: user.id },
            },
          },
        });

        return { comment: createdComment, createdAttachments: createdAttRecords };
      }, DB_TRANSACTION_OPTIONS)
    );

    // Fetch full task to determine authorized spaces for mention scope & notifications
    const taskDetails = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        taskKey: true,
        title: true,
        createdById: true,
        assigneeId: true,
        spaceId: true,
        originSpaceId: true,
        history: {
          where: { actionType: 'HANDOFF_TRANSFER' },
          select: { fromSpaceId: true, toSpaceId: true },
        },
      },
    });

    if (taskDetails) {
      const authorizedSpaceIds = new Set<string>();
      if (taskDetails.spaceId) authorizedSpaceIds.add(taskDetails.spaceId);
      if (taskDetails.originSpaceId) authorizedSpaceIds.add(taskDetails.originSpaceId);
      for (const h of taskDetails.history) {
        if (h.fromSpaceId) authorizedSpaceIds.add(h.fromSpaceId);
        if (h.toSpaceId) authorizedSpaceIds.add(h.toSpaceId);
      }

      const snippet = comment.content.length > 80 ? `${comment.content.substring(0, 80)}...` : comment.content;

      // 1. Parse @mentions (@username and @everyone)
      const rawMentions = Array.from(comment.content.matchAll(/@([a-zA-Z0-9_]+)/g), (m) => m[1].toLowerCase());
      const uniqueMentions = Array.from(new Set(rawMentions));
      const hasEveryone = uniqueMentions.includes('everyone');
      const specificUsernames = uniqueMentions.filter((m) => m !== 'everyone');

      const notifiedUserIds = new Set<string>();
      notifiedUserIds.add(user.id); // Never notify the comment author

      // Dispatch @everyone mention notifications strictly to authorized department staff
      if (hasEveryone) {
        const spaceStaff = await prisma.spaceMember.findMany({
          where: { spaceId: { in: Array.from(authorizedSpaceIds) } },
          select: { userId: true },
        });
        const spaceObjs = await prisma.space.findMany({
          where: { id: { in: Array.from(authorizedSpaceIds) } },
          select: { departmentHeadId: true },
        });
        const targets = new Set(spaceStaff.map((m) => m.userId));
        for (const s of spaceObjs) {
          if (s.departmentHeadId) targets.add(s.departmentHeadId);
        }

        if (!comment.isInternal) {
          if (taskDetails.createdById) targets.add(taskDetails.createdById);
          if (taskDetails.assigneeId) targets.add(taskDetails.assigneeId);
        }

        for (const targetId of targets) {
          if (!notifiedUserIds.has(targetId)) {
            // Internal note protection: never notify ticket creator if creator is non-staff
            if (comment.isInternal && targetId === taskDetails.createdById) {
              const isCreatorStaff =
                spaceStaff.some((m) => m.userId === targetId) ||
                spaceObjs.some((s) => s.departmentHeadId === targetId);
              if (!isCreatorStaff) continue;
            }

            await createNotification({
              userId: targetId,
              taskId: taskDetails.id,
              title: `Mentioned in ${taskDetails.taskKey}`,
              message: `${user.name} mentioned @everyone in ${comment.isInternal ? 'an internal note' : 'a reply'}: '${snippet}'`,
            });
            notifiedUserIds.add(targetId);
          }
        }
      }

      // Dispatch specific @username mention notifications with RBAC scope validation
      if (specificUsernames.length > 0) {
        const mentionedUsers = await prisma.user.findMany({
          where: {
            username: { in: specificUsernames },
            isActive: true,
          },
          select: {
            id: true,
            username: true,
            globalRole: true,
            spaceMemberships: { select: { spaceId: true } },
            headedSpaces: { select: { id: true } },
          },
        });

        for (const target of mentionedUsers) {
          if (notifiedUserIds.has(target.id)) continue;

          // Scope RBAC Check: Candidate MUST have access to ticket
          const isTicketAuthorized =
            target.globalRole === 'SUPERADMIN' ||
            target.id === taskDetails.createdById ||
            target.id === taskDetails.assigneeId ||
            target.spaceMemberships.some((m) => authorizedSpaceIds.has(m.spaceId)) ||
            target.headedSpaces.some((s) => authorizedSpaceIds.has(s.id));

          if (!isTicketAuthorized) {
            // Silently ignore/strip unauthorized @mentions
            continue;
          }

          // RBAC Check: If internal note, target MUST hold clearance in the task space
          if (comment.isInternal) {
            const hasClearance =
              target.globalRole === 'SUPERADMIN' ||
              target.spaceMemberships.some((m) => m.spaceId === taskDetails.spaceId) ||
              target.headedSpaces.some((s) => s.id === taskDetails.spaceId);

            if (!hasClearance) {
              continue; // Skip: cannot leak internal staff note to non-cleared user
            }
          }

          await createNotification({
            userId: target.id,
            taskId: taskDetails.id,
            title: `Mentioned in ${taskDetails.taskKey}`,
            message: `${user.name} mentioned you in ${taskDetails.taskKey}: '${snippet}'`,
          });
          notifiedUserIds.add(target.id);
        }
      }

      // 2. Standard Discussion Notifications (skipping already notified mentioned users)
      if (!comment.isInternal) {
        // Public discussion reply
        if (user.id === taskDetails.createdById) {
          // Author is creator: notify assigned agent (or all space staff if unassigned)
          if (taskDetails.assigneeId && !notifiedUserIds.has(taskDetails.assigneeId)) {
            await createNotification({
              userId: taskDetails.assigneeId,
              taskId: taskDetails.id,
              title: `New Reply: ${taskDetails.taskKey}`,
              message: `${user.name} replied on ${taskDetails.taskKey}: '${snippet}'`,
            });
            notifiedUserIds.add(taskDetails.assigneeId);
          } else if (!taskDetails.assigneeId) {
            // Unassigned: notify all space staff
            await notifySpaceMembers({
              spaceId: taskDetails.spaceId,
              excludeUserIds: Array.from(notifiedUserIds),
              taskId: taskDetails.id,
              title: `New Reply: ${taskDetails.taskKey}`,
              message: `${user.name} replied on ${taskDetails.taskKey}: '${snippet}'`,
            });
          }
        } else {
          // Author is staff/other user: notify creator
          if (taskDetails.createdById && !notifiedUserIds.has(taskDetails.createdById)) {
            await createNotification({
              userId: taskDetails.createdById,
              taskId: taskDetails.id,
              title: `New Reply: ${taskDetails.taskKey}`,
              message: `${user.name} replied on ${taskDetails.taskKey}: '${snippet}'`,
            });
            notifiedUserIds.add(taskDetails.createdById);
          }

          // If an assignee exists and was not notified, notify assignee too
          if (taskDetails.assigneeId && !notifiedUserIds.has(taskDetails.assigneeId)) {
            await createNotification({
              userId: taskDetails.assigneeId,
              taskId: taskDetails.id,
              title: `New Reply: ${taskDetails.taskKey}`,
              message: `${user.name} replied on ${taskDetails.taskKey}: '${snippet}'`,
            });
            notifiedUserIds.add(taskDetails.assigneeId);
          }
        }
      } else {
        // Staff internal note: dispatch ONLY to staff members of that Space
        const excludeList = Array.from(notifiedUserIds);
        if (taskDetails.createdById) {
          excludeList.push(taskDetails.createdById);
        }

        // Notify space staff (excluding author, creator, and already notified mentions)
        await notifySpaceMembers({
          spaceId: taskDetails.spaceId,
          excludeUserIds: excludeList,
          taskId: taskDetails.id,
          title: `Internal Note: ${taskDetails.taskKey}`,
          message: `${user.name} added an internal note on ${taskDetails.taskKey}: '${snippet}'`,
        });

        // Notify assigned agent if not in excludeList
        if (taskDetails.assigneeId && !excludeList.includes(taskDetails.assigneeId)) {
          await createNotification({
            userId: taskDetails.assigneeId,
            taskId: taskDetails.id,
            title: `Internal Note: ${taskDetails.taskKey}`,
            message: `${user.name} added an internal note on ${taskDetails.taskKey}: '${snippet}'`,
          });
          notifiedUserIds.add(taskDetails.assigneeId);
        }
      }
    }

    const commentWithAttachments = {
      ...comment,
      attachments: commentAttachmentsList,
    };

    // Real-Time LAN Pipeline: Broadcast COMMENT_CREATED
    if (taskDetails) {
      const commentCreatedEvent = {
        type: 'COMMENT_CREATED',
        taskId,
        spaceId: taskDetails.spaceId,
        comment: commentWithAttachments,
        isInternal,
        timestamp: new Date().toISOString(),
      };

      if (isInternal) {
        // CRITICAL: NEVER broadcast internal notes to creator or non-staff requesters!
        await broadcastToSpaceStaff(taskDetails.spaceId, commentCreatedEvent, []);
      } else {
        // Public reply: broadcast to space staff + creator (and assignee if exists)
        const extraUsers: string[] = [];
        if (taskDetails.createdById && taskDetails.createdById !== user.id) {
          extraUsers.push(taskDetails.createdById);
        }
        if (taskDetails.assigneeId && taskDetails.assigneeId !== user.id) {
          extraUsers.push(taskDetails.assigneeId);
        }
        await broadcastToSpaceStaff(taskDetails.spaceId, commentCreatedEvent, extraUsers);
      }
    }

    if (Array.isArray(createdAttachments) && createdAttachments.length > 0) {
      appendAttachmentsToMasterStore(taskId, createdAttachments);
    }
    invalidateCachePrefix('tasks:');
    invalidateCachePrefix(`task:detail:${taskId}`);
    invalidateCachePrefix('notifications:user:');

    return NextResponse.json({ success: true, comment: commentWithAttachments, createdAttachments }, { status: 201 });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    console.error('Failed to post comment:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error creating comment' },
      { status: 500 }
    );
  }
}
