/**
 * Shared Client-Side File Uploader with 2MB Chunked Resumable Streaming & Concurrency Queue
 *
 * - Strictly slices files > 2MB into 2,097,152-byte (2MB, exact 256KB multiple) chunks
 *   and streams them sequentially via PUT /api/attachments/stage -> Google Drive Resumable API.
 * - Because every HTTP request is <= 2MB, Vercel's 4.5MB serverless body ceiling can NEVER
 *   be exceeded (0% chance of HTTP_413_PAYLOAD_TOO_LARGE) and browser CORS can NEVER block it!
 * - Includes a lightweight concurrency queue (MAX_CONCURRENT_FILE_UPLOADS = 2) so multiple
 *   dropped files upload smoothly without saturating browser or serverless connections.
 */

export interface StagedAttachmentMetadata {
  fileId: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
}

export interface UploadFileOptions {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
export const CHUNK_SIZE = 2 * 1024 * 1024; // 2,097,152 bytes (2MB — exact multiple of 256KB required by Google Drive)
const MAX_CONCURRENT_FILE_UPLOADS = 2;

let activeUploadCount = 0;
const uploadWaitQueue: Array<() => void> = [];

function acquireUploadSlot(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    const abortErr = new Error('Upload aborted');
    abortErr.name = 'AbortError';
    return Promise.reject(abortErr);
  }

  if (activeUploadCount < MAX_CONCURRENT_FILE_UPLOADS) {
    activeUploadCount += 1;
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const startTask = () => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      activeUploadCount += 1;
      resolve();
    };

    const onAbort = () => {
      const idx = uploadWaitQueue.indexOf(startTask);
      if (idx !== -1) {
        uploadWaitQueue.splice(idx, 1);
      }
      const abortErr = new Error('Upload aborted');
      abortErr.name = 'AbortError';
      reject(abortErr);
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    uploadWaitQueue.push(startTask);
  });
}

function releaseUploadSlot(): void {
  activeUploadCount = Math.max(0, activeUploadCount - 1);
  if (uploadWaitQueue.length > 0 && activeUploadCount < MAX_CONCURRENT_FILE_UPLOADS) {
    const next = uploadWaitQueue.shift();
    if (next) {
      next();
    }
  }
}

/**
 * Executes a 2MB sequential chunked resumable upload via INIT_LARGE_UPLOAD + PUT /api/attachments/stage.
 * Every request is <= 2MB, completely eliminating Vercel 413 errors and browser CORS issues.
 */
async function executeChunkedResumableUpload(
  file: File,
  options?: UploadFileOptions
): Promise<StagedAttachmentMetadata> {
  const onProgress = options?.onProgress;
  const signal = options?.signal;
  const mimeType = file.type || 'application/octet-stream';

  // Step 1: Initialize resumable session on server (< 200 bytes JSON)
  const initRes = await fetch('/api/attachments/stage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'INIT_LARGE_UPLOAD',
      fileName: file.name,
      mimeType,
      fileSize: file.size,
    }),
    signal,
  });

  if (!initRes.ok) {
    const errData = await initRes.json().catch(() => ({}));
    throw new Error(errData.error || `Failed to initialize resumable upload (HTTP ${initRes.status})`);
  }

  const initData = await initRes.json();
  const uploadUrl: string | undefined = initData.uploadUrl;
  if (!uploadUrl) {
    throw new Error(initData.error || 'Server did not return a resumable uploadUrl.');
  }

  onProgress?.(6);

  const totalBytes = file.size;
  let offset = 0;
  let finalStagedAttachment: StagedAttachmentMetadata | null = null;

  // Step 2: Sequentially stream 2MB chunks (chunk 0 -> chunk 1 -> ...)
  while (offset < totalBytes) {
    if (signal?.aborted) {
      const abortErr = new Error('Upload aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    const end = Math.min(offset + CHUNK_SIZE, totalBytes);
    const chunkBlob = file.slice(offset, end);
    const contentRange = `bytes ${offset}-${end - 1}/${totalBytes}`;
    const currentOffset = offset;

    const chunkResult = await new Promise<{
      ok: boolean;
      status: number;
      completed?: boolean;
      stagedAttachment?: StagedAttachmentMetadata;
    }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', '/api/attachments/stage', true);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('x-upload-url', uploadUrl);
      xhr.setRequestHeader('x-content-range', contentRange);
      xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));
      xhr.setRequestHeader(
        'x-saved-file-name',
        encodeURIComponent(initData.savedFileName || file.name)
      );
      xhr.setRequestHeader('x-file-type', mimeType);
      xhr.setRequestHeader('x-file-size', String(totalBytes));
      xhr.setRequestHeader('x-folder-id', String(initData.folderId || ''));
      xhr.setRequestHeader('x-sub-folder', String(initData.subFolder || ''));

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && totalBytes > 0) {
          const uploadedSoFar = Math.min(totalBytes, currentOffset + e.loaded);
          const pct = Math.max(6, Math.min(98, Math.round((uploadedSoFar / totalBytes) * 98)));
          onProgress?.(pct);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const parsed = JSON.parse(xhr.responseText || '{}');
            resolve(parsed);
          } catch (err) {
            reject(new Error('Invalid JSON response during chunk upload.'));
          }
        } else {
          let errMsg = `Chunk upload failed (HTTP ${xhr.status})`;
          try {
            const parsedErr = JSON.parse(xhr.responseText || '{}');
            if (parsedErr.error) errMsg = parsedErr.error;
          } catch { }
          reject(new Error(errMsg));
        }
      };

      xhr.onerror = () => reject(new Error('Network error while uploading file chunk.'));
      xhr.onabort = () => {
        const abortErr = new Error('Upload aborted');
        abortErr.name = 'AbortError';
        reject(abortErr);
      };

      if (signal) {
        if (signal.aborted) {
          xhr.abort();
          return;
        }
        signal.addEventListener('abort', () => xhr.abort(), { once: true });
      }

      xhr.send(chunkBlob);
    });

    if (chunkResult.completed && chunkResult.stagedAttachment) {
      finalStagedAttachment = chunkResult.stagedAttachment;
    }

    offset = end;
    const postChunkPct = Math.max(6, Math.min(99, Math.round((offset / totalBytes) * 98)));
    onProgress?.(postChunkPct);
  }

  // Fallback finalization if final chunk did not already return stagedAttachment
  if (!finalStagedAttachment) {
    const finalizeRes = await fetch('/api/attachments/stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'FINALIZE_LARGE_UPLOAD',
        fileName: file.name,
        savedFileName: initData.savedFileName,
        folderId: initData.folderId,
        subFolder: initData.subFolder,
        mimeType,
        fileSize: file.size,
      }),
      signal,
    });

    if (!finalizeRes.ok) {
      const errData = await finalizeRes.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to finalize uploaded file.');
    }

    const finalizeData = await finalizeRes.json();
    finalStagedAttachment = finalizeData.stagedAttachment;
  }

  if (!finalStagedAttachment) {
    throw new Error('Server did not return stagedAttachment metadata after chunked upload.');
  }

  onProgress?.(100);
  return finalStagedAttachment;
}

/**
 * Single-shot multipart upload strictly for small files <= 2MB.
 */
async function executeSmallFileMultipartUpload(
  file: File,
  options?: UploadFileOptions
): Promise<StagedAttachmentMetadata> {
  const onProgress = options?.onProgress;
  const signal = options?.signal;

  return new Promise<StagedAttachmentMetadata>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);

    xhr.open('POST', '/api/attachments/stage', true);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        const percent = Math.max(5, Math.min(95, Math.round((e.loaded / e.total) * 95)));
        onProgress?.(percent);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText || '{}');
          if (!data.stagedAttachment) {
            throw new Error('Invalid response from attachment staging endpoint.');
          }
          onProgress?.(100);
          resolve(data.stagedAttachment as StagedAttachmentMetadata);
        } catch (err: any) {
          reject(err);
        }
      } else {
        let errMsg = `Failed to upload attachment (HTTP ${xhr.status})`;
        try {
          const errData = JSON.parse(xhr.responseText || '{}');
          if (errData.error) errMsg = errData.error;
        } catch { }
        reject(new Error(errMsg));
      }
    };

    xhr.onerror = () => reject(new Error('Network error uploading file'));
    xhr.onabort = () => {
      const abortErr = new Error('Upload aborted');
      abortErr.name = 'AbortError';
      reject(abortErr);
    };

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(formData);
  });
}

/**
 * Uploads a file with real-time progress reporting and 2-file concurrency queuing.
 * - Files > 2MB ALWAYS use 2MB sequential chunked resumable streaming (`PUT /api/attachments/stage`),
 *   never sending > 2MB in a single request and never triggering HTTP 413 on Vercel.
 * - Files <= 2MB use fast single-shot multipart staging with automatic fallback to chunked streaming.
 */
export async function uploadFileWithProgress(
  file: File,
  options?: UploadFileOptions
): Promise<StagedAttachmentMetadata> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `File "${file.name}" exceeds the 100MB maximum limit (${(file.size / (1024 * 1024)).toFixed(1)}MB).`
    );
  }

  const onProgress = options?.onProgress;
  const signal = options?.signal;

  // Report initial queued state (5%) before waiting for concurrency slot
  onProgress?.(5);

  await acquireUploadSlot(signal);

  try {
    // For ANY file > 2MB, strictly use the 2MB Chunked Resumable Pipeline (NEVER single FormData!)
    if (file.size > CHUNK_SIZE) {
      return await executeChunkedResumableUpload(file, options);
    }

    // For small files <= 2MB, use fast single-shot upload with fallback to chunked resumable
    try {
      return await executeSmallFileMultipartUpload(file, options);
    } catch (smallErr: any) {
      if (smallErr?.name === 'AbortError') throw smallErr;
      return await executeChunkedResumableUpload(file, options);
    }
  } finally {
    releaseUploadSlot();
  }
}
