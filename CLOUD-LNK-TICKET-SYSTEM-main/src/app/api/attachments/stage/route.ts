import { NextRequest, NextResponse } from 'next/server';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import {
  isGoogleDriveStorage,
  uploadToGoogleDrive,
  deleteFromGoogleDrive,
  setCachedDriveFile,
  removeCachedDriveFile,
  extractDriveFileId,
  getGoogleDriveUploadSession,
  resolveUploadedDriveFile,
} from '@/lib/google-drive-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes for up to 100MB

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

// POST /api/attachments/stage - Pre-upload staged file to Google Drive (supports up to 100MB & Direct Resumable)
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const contentType = request.headers.get('content-type') || '';

    // 1. JSON Actions: INIT_LARGE_UPLOAD & FINALIZE_LARGE_UPLOAD (Vercel 4.5MB Bypass -> Direct Browser-to-Drive Resumable Session)
    if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => ({}));

      if (body.action === 'INIT_LARGE_UPLOAD') {
        const { fileName, mimeType, fileSize } = body;
        if (!fileName) {
          return NextResponse.json({ error: 'fileName is required.' }, { status: 400 });
        }
        if (fileSize && Number(fileSize) > MAX_FILE_SIZE) {
          return NextResponse.json(
            { error: `File "${fileName}" exceeds the 100MB maximum limit (${(Number(fileSize) / (1024 * 1024)).toFixed(1)}MB).` },
            { status: 400 }
          );
        }
        if (!isAllowedFileType(fileName, mimeType)) {
          return NextResponse.json(
            { error: `Unsupported file type for "${fileName}". Allowed: documents, videos, archives, CAD, and images.` },
            { status: 400 }
          );
        }

        const d = new Date();
        const subFolder = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const rawName = fileName || 'unnamed-attachment';
        const sanitizedName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const savedFileName = `${Date.now()}-${sanitizedName}`;

        const isDrive = isGoogleDriveStorage();
        if (isDrive) {
          const originHeader = request.headers.get('origin') || request.nextUrl.origin;
          const session = await getGoogleDriveUploadSession({
            target: 'ATTACHMENTS',
            fileName: savedFileName,
            mimeType: mimeType || 'application/octet-stream',
            subFolder,
            origin: originHeader || undefined,
            fileSize: Number(fileSize || 0),
          });

          if (session.ok && session.uploadUrl) {
            return NextResponse.json({
              ok: true,
              success: true,
              mode: 'CHUNKED_RESUMABLE',
              uploadUrl: session.uploadUrl,
              folderId: session.folderId,
              fileName: rawName,
              savedFileName,
              subFolder,
            });
          }

          return NextResponse.json(
            {
              ok: false,
              error: session.error || 'Failed to initialize Google Drive resumable upload session.',
            },
            { status: 500 }
          );
        }

        // On-Premise local disk chunked upload session
        return NextResponse.json({
          ok: true,
          success: true,
          mode: 'CHUNKED_RESUMABLE',
          uploadUrl: `local://${savedFileName}`,
          folderId: 'local',
          fileName: rawName,
          savedFileName,
          subFolder,
        });
      }

      if (body.action === 'FINALIZE_LARGE_UPLOAD') {
        const { fileId, fileName, savedFileName, folderId, subFolder, mimeType, fileSize } = body;
        const rawName = fileName || savedFileName || 'unnamed-attachment';
        const resolved = await resolveUploadedDriveFile({
          fileId,
          savedFileName: savedFileName || rawName,
          folderId,
          subFolder,
        });

        if (!resolved.ok || !resolved.fileId) {
          return NextResponse.json(
            { error: resolved.error || 'Could not finalize uploaded file on Google Drive.' },
            { status: 500 }
          );
        }

        const fileUrl = `/api/attachments/drive/${resolved.fileId}?name=${encodeURIComponent(rawName)}`;
        return NextResponse.json(
          {
            success: true,
            stagedAttachment: {
              fileId: resolved.fileId,
              fileName: rawName,
              fileUrl,
              fileType: mimeType || 'application/octet-stream',
              fileSize: Math.max(0, Math.round(Number(fileSize || 0))),
            },
          },
          { status: 201 }
        );
      }
    }

    // 2. Standard Multipart / Direct Upload (Up to 100MB)
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: 'No file provided in form data.' }, { status: 400 });
    }

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

    const rawName = file.name || 'unnamed-attachment';
    const sanitizedName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const timestamp = Date.now();
    const savedFileName = `${timestamp}-${sanitizedName}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const isDrive = isGoogleDriveStorage();
    const d = new Date();
    const subFolder = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    if (isDrive) {
      const driveUpload = await uploadToGoogleDrive({
        target: 'ATTACHMENTS',
        fileName: savedFileName,
        mimeType: fileType,
        buffer,
        subFolder,
      });

      const fileUrl = `/api/attachments/drive/${driveUpload.fileId}?name=${encodeURIComponent(rawName)}`;

      // Save local fallback copy if writable and <= 15MB
      if (buffer.length <= 15 * 1024 * 1024) {
        try {
          const stagedDir = path.join(process.cwd(), 'public', 'uploads', 'staged');
          await fs.mkdir(stagedDir, { recursive: true });
          await fs.writeFile(path.join(stagedDir, `${driveUpload.fileId}-${savedFileName}`), buffer);
        } catch { }
      }

      return NextResponse.json({
        success: true,
        stagedAttachment: {
          fileId: driveUpload.fileId,
          fileName: rawName,
          fileUrl,
          fileType,
          fileSize: buffer.length,
        },
      }, { status: 201 });
    } else {
      const stagedDir = path.join(process.cwd(), 'public', 'uploads', 'staged');
      await fs.mkdir(stagedDir, { recursive: true });
      await fs.writeFile(path.join(stagedDir, savedFileName), buffer);

      const fileUrl = `/uploads/staged/${savedFileName}`;

      if (buffer.length <= 15 * 1024 * 1024) {
        setCachedDriveFile(savedFileName, {
          buffer,
          mimeType: fileType,
          fileName: rawName,
        });
      }

      return NextResponse.json({
        success: true,
        stagedAttachment: {
          fileId: savedFileName,
          fileName: rawName,
          fileUrl,
          fileType,
          fileSize: buffer.length,
        },
      }, { status: 201 });
    }
  } catch (error: any) {
    console.error('[Attachment Staging] Upload error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to stage attachment.' },
      { status: error?.status || 500 }
    );
  }
}

// PUT /api/attachments/stage - Upload a <= 2MB binary chunk to an active Resumable Upload session
// Eliminates Vercel HTTP 413 Payload Too Large and browser CORS restrictions 100% of the time!
export async function PUT(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const uploadUrl = request.headers.get('x-upload-url') || '';
    const contentRange = request.headers.get('x-content-range') || '';
    const rawFileNameHeader = request.headers.get('x-file-name') || 'unnamed-attachment';
    const rawSavedNameHeader = request.headers.get('x-saved-file-name') || '';
    const fileType = request.headers.get('x-file-type') || 'application/octet-stream';
    const fileSize = Math.max(0, Math.round(Number(request.headers.get('x-file-size') || 0)));
    const folderId = request.headers.get('x-folder-id') || '';
    const subFolder = request.headers.get('x-sub-folder') || '';

    let fileName = rawFileNameHeader;
    try {
      fileName = decodeURIComponent(rawFileNameHeader);
    } catch {}

    let savedFileName = rawSavedNameHeader || fileName;
    try {
      if (rawSavedNameHeader) savedFileName = decodeURIComponent(rawSavedNameHeader);
    } catch {}

    if (!uploadUrl || !contentRange) {
      return NextResponse.json(
        { error: 'Missing required x-upload-url or x-content-range headers.' },
        { status: 400 }
      );
    }

    const chunkArrayBuffer = await request.arrayBuffer();
    const chunkBuffer = Buffer.from(chunkArrayBuffer);

    if (chunkBuffer.byteLength === 0) {
      return NextResponse.json({ error: 'Empty chunk body.' }, { status: 400 });
    }

    // Parse "bytes start-end/total"
    const rangeMatch = contentRange.match(/bytes\s+(\d+)-(\d+)\/(\d+)/i);
    const rangeStart = rangeMatch ? Number(rangeMatch[1]) : 0;
    const rangeEnd = rangeMatch ? Number(rangeMatch[2]) : chunkBuffer.byteLength - 1;
    const totalBytes = rangeMatch ? Number(rangeMatch[3]) : fileSize || chunkBuffer.byteLength;
    const isFinalChunk = rangeEnd + 1 >= totalBytes;

    // On-Premise Local Disk Chunk Assembly
    if (uploadUrl.startsWith('local://')) {
      const localName = uploadUrl.slice('local://'.length) || savedFileName;
      const stagedDir = path.join(process.cwd(), 'public', 'uploads', 'staged');
      await fs.mkdir(stagedDir, { recursive: true });
      const targetPath = path.join(stagedDir, localName);

      if (rangeStart === 0) {
        await fs.writeFile(targetPath, chunkBuffer);
      } else {
        await fs.appendFile(targetPath, chunkBuffer);
      }

      if (!isFinalChunk) {
        return NextResponse.json({ ok: true, status: 308, completed: false });
      }

      const fileUrl = `/uploads/staged/${localName}`;
      return NextResponse.json({
        ok: true,
        status: 200,
        completed: true,
        stagedAttachment: {
          fileId: localName,
          fileName,
          fileUrl,
          fileType,
          fileSize: totalBytes,
        },
      });
    }

    // Bridge-Resumable Chunk Assembly (stages 2MB chunks in os.tmpdir() / Vercel /tmp and uploads assembled binary to Google Drive)
    if (uploadUrl.startsWith('bridge-resumable://')) {
      const sessionKey = (
        uploadUrl.slice('bridge-resumable://'.length) || savedFileName
      ).replace(/[^a-zA-Z0-9._-]/g, '_');
      const tmpChunkDir = path.join(os.tmpdir(), 'lnk-drive-chunks');
      await fs.mkdir(tmpChunkDir, { recursive: true });
      const tmpFilePath = path.join(tmpChunkDir, `${sessionKey}.part`);

      if (rangeStart === 0) {
        await fs.writeFile(tmpFilePath, chunkBuffer);
      } else {
        await fs.appendFile(tmpFilePath, chunkBuffer);
      }

      if (!isFinalChunk) {
        return NextResponse.json({
          ok: true,
          status: 308,
          completed: false,
        });
      }

      // Final chunk received: read assembled buffer from os.tmpdir() and upload to Google Drive
      const assembledBuffer = await fs.readFile(tmpFilePath);
      await fs.unlink(tmpFilePath).catch(() => {});

      const d = new Date();
      const effectiveSubFolder =
        subFolder || `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      const driveUpload = await uploadToGoogleDrive({
        target: 'ATTACHMENTS',
        fileName: savedFileName,
        mimeType: fileType,
        buffer: assembledBuffer,
        subFolder: effectiveSubFolder,
      });

      const fileUrl = `/api/attachments/drive/${driveUpload.fileId}?name=${encodeURIComponent(fileName)}`;
      return NextResponse.json({
        ok: true,
        status: 200,
        completed: true,
        stagedAttachment: {
          fileId: driveUpload.fileId,
          fileName,
          fileUrl,
          fileType,
          fileSize: assembledBuffer.length,
        },
      });
    }

    // Forward 2MB chunk directly from Node.js to Google Drive Resumable Session URL
    const driveRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(chunkBuffer.byteLength),
        'Content-Range': contentRange,
      },
      body: chunkBuffer,
    });

    // Google Drive returns 308 Resume Incomplete for all intermediate chunks
    if (driveRes.status === 308) {
      return NextResponse.json({
        ok: true,
        status: 308,
        completed: false,
      });
    }

    if (driveRes.status >= 200 && driveRes.status < 300) {
      let fileId: string | undefined;
      try {
        const driveJson = await driveRes.json();
        if (driveJson && typeof driveJson.id === 'string') {
          fileId = driveJson.id;
        }
      } catch {
        // Fallback lookup below if JSON body wasn't returned
      }

      if (!fileId) {
        const resolved = await resolveUploadedDriveFile({
          savedFileName,
          folderId: folderId || undefined,
          subFolder: subFolder || undefined,
        });
        if (resolved.ok && resolved.fileId) {
          fileId = resolved.fileId;
        }
      }

      if (!fileId) {
        return NextResponse.json(
          { error: 'Final chunk uploaded, but Google Drive did not return a fileId.' },
          { status: 500 }
        );
      }

      const fileUrl = `/api/attachments/drive/${fileId}?name=${encodeURIComponent(fileName)}`;
      return NextResponse.json({
        ok: true,
        status: 200,
        completed: true,
        stagedAttachment: {
          fileId,
          fileName,
          fileUrl,
          fileType,
          fileSize: totalBytes,
        },
      });
    }

    const errText = await driveRes.text().catch(() => '');
    return NextResponse.json(
      {
        error: `Google Drive chunk upload failed with HTTP ${driveRes.status}: ${errText.slice(0, 200)}`,
      },
      { status: 502 }
    );
  } catch (error: any) {
    console.error('[PUT /api/attachments/stage] Chunk upload error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to upload file chunk.' },
      { status: 500 }
    );
  }
}

// DELETE /api/attachments/stage - Cleanup staged files on file removal or modal cancellation
export async function DELETE(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch { }

    const fileIdsToDelete = new Set<string>();

    if (Array.isArray(body.fileIds)) {
      for (const id of body.fileIds) {
        if (typeof id === 'string' && id.trim()) {
          fileIdsToDelete.add(id.trim());
        }
      }
    } else if (typeof body.fileId === 'string' && body.fileId.trim()) {
      fileIdsToDelete.add(body.fileId.trim());
    }

    if (Array.isArray(body.fileUrls)) {
      for (const url of body.fileUrls) {
        if (typeof url === 'string') {
          const extracted = extractDriveFileId(url);
          if (extracted) fileIdsToDelete.add(extracted);
        }
      }
    } else if (typeof body.fileUrl === 'string') {
      const extracted = extractDriveFileId(body.fileUrl);
      if (extracted) fileIdsToDelete.add(extracted);
    }

    const idsArray = Array.from(fileIdsToDelete);
    if (idsArray.length === 0) {
      return NextResponse.json({ success: true, deletedCount: 0 });
    }

    const isDrive = isGoogleDriveStorage();

    await Promise.allSettled(
      idsArray.map(async (fileId) => {
        // 1. Remove from in-memory RAM cache
        removeCachedDriveFile(fileId);

        // 2. Trash from Google Drive if Google Drive storage
        if (isDrive) {
          try {
            await deleteFromGoogleDrive(fileId);
          } catch (err: any) {
            console.warn(`[Attachment Staging] Google Drive delete warning for ${fileId}:`, err.message);
          }
        }

        // 3. Remove local mirror or staged file if exists
        try {
          const stagedDir = path.join(process.cwd(), 'public', 'uploads', 'staged');
          const entries = await fs.readdir(stagedDir).catch(() => []);
          for (const entry of entries) {
            if (entry.includes(fileId)) {
              await fs.unlink(path.join(stagedDir, entry)).catch(() => { });
            }
          }
        } catch { }
      })
    );

    return NextResponse.json({
      success: true,
      deletedCount: idsArray.length,
      deletedFileIds: idsArray,
    });
  } catch (error: any) {
    console.error('[Attachment Staging] Delete error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to delete staged attachments.' },
      { status: 500 }
    );
  }
}
