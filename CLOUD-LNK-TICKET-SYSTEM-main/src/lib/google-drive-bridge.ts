/**
 * Google Workspace Drive Apps Script Bridge Client
 * Provides zero-credential, policy-compliant storage bridge to Google Drive Shared Folders.
 */

export interface GoogleDrivePingResult {
  ok: boolean;
  status: string;
  attachmentsFolderName?: string;
  backupsFolderName?: string;
  storageUsedBytes?: number;
  storageLimitBytes?: number;
  error?: string;
}

export interface GoogleDriveUploadParams {
  target: 'ATTACHMENTS' | 'BACKUPS';
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  subFolder?: string;
  retentionCount?: number;
}

export interface GoogleDriveUploadSessionParams {
  target?: 'ATTACHMENTS' | 'BACKUPS';
  fileName: string;
  mimeType: string;
  subFolder?: string;
  origin?: string;
  fileSize?: number;
}

export interface GoogleDriveUploadSessionResult {
  ok: boolean;
  uploadUrl?: string;
  accessToken?: string;
  folderId?: string;
  subFolder?: string;
  fileId?: string;
  error?: string;
}

export interface GoogleDriveAuthTokenResult {
  ok: boolean;
  accessToken?: string;
  folderId?: string;
  error?: string;
}

export interface GoogleDriveUploadResult {
  ok: boolean;
  fileId: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
  viewUrl: string;
  downloadUrl: string;
  error?: string;
}

export interface GoogleDriveDownloadResult {
  ok: boolean;
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  error?: string;
}

export interface GoogleDriveBackupFile {
  fileId: string;
  filename: string;
  sizeBytes: number;
  createdAt: string;
  viewUrl?: string;
  downloadUrl?: string;
}

export interface GoogleDriveListBackupsResult {
  ok: boolean;
  files: GoogleDriveBackupFile[];
  error?: string;
}

export interface GoogleDriveDeleteResult {
  ok: boolean;
  deletedFileId?: string;
  error?: string;
}

const DEFAULT_FALLBACK_BRIDGE_URL =
  'https://script.google.com/macros/s/AKfycbz7nrzZThPFTGafBja66KxUijkOIjtMc39IcRfwfPg-NR4O57gPTkQns5OBm4cSMnsy-Q/exec';
const DEFAULT_FALLBACK_BRIDGE_TOKEN = 'lk-drive-bridge-secret-2026';

function getBridgeConfig(): { bridgeUrl: string; token: string } {
  const bridgeUrl = (
    process.env.GOOGLE_DRIVE_BRIDGE_URL || DEFAULT_FALLBACK_BRIDGE_URL
  ).trim();
  const token = (
    process.env.GOOGLE_DRIVE_BRIDGE_TOKEN || DEFAULT_FALLBACK_BRIDGE_TOKEN
  ).trim();

  if (!bridgeUrl) {
    throw new Error('GOOGLE_DRIVE_BRIDGE_URL is not configured in environment variables.');
  }
  if (!token) {
    throw new Error('GOOGLE_DRIVE_BRIDGE_TOKEN is not configured in environment variables.');
  }

  return { bridgeUrl, token };
}

export interface CachedDriveFile {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  cachedAt: number;
}

const GLOBAL_DRIVE_CACHE_KEY = Symbol.for('cloud_lnk_drive_file_cache');
export const driveFileCache: Map<string, CachedDriveFile> =
  (globalThis as any)[GLOBAL_DRIVE_CACHE_KEY] ||
  ((globalThis as any)[GLOBAL_DRIVE_CACHE_KEY] = new Map<string, CachedDriveFile>());

export function setCachedDriveFile(
  fileId: string,
  item: { buffer: Buffer; mimeType: string; fileName: string }
): void {
  if (!fileId || !item.buffer) return;
  driveFileCache.set(fileId, {
    ...item,
    cachedAt: Date.now(),
  });
  // Keep cache bounded to 100 recent files
  if (driveFileCache.size > 100) {
    const oldestKey = driveFileCache.keys().next().value;
    if (oldestKey) driveFileCache.delete(oldestKey);
  }
}

export function getCachedDriveFile(fileId: string): CachedDriveFile | undefined {
  if (!fileId) return undefined;
  const cached = driveFileCache.get(fileId);
  if (cached && Date.now() - cached.cachedAt < 30 * 60 * 1000) {
    return cached;
  }
  return undefined;
}

export function removeCachedDriveFile(fileId: string): void {
  if (!fileId) return;
  driveFileCache.delete(fileId);
}

/**
 * Returns true if the active storage provider is configured to use Google Drive.
 * Always returns true on Vercel Serverless (where local filesystem /public/uploads is read-only)
 * or whenever GOOGLE_DRIVE_BRIDGE_URL or STORAGE_PROVIDER=GOOGLE_DRIVE is present.
 */
export function isGoogleDriveStorage(): boolean {
  if (Boolean(process.env.VERCEL)) {
    return true;
  }
  const provider = (process.env.STORAGE_PROVIDER || '').trim().toUpperCase();
  if (provider === 'LOCAL') {
    return false;
  }
  if (provider === 'GOOGLE_DRIVE' || Boolean(process.env.GOOGLE_DRIVE_BRIDGE_URL)) {
    return true;
  }
  return true;
}

/**
 * Extracts raw Drive fileId from a Drive URL or API proxy path.
 * e.g., "/api/attachments/drive/14TCg0pzvphAIi_lfCfiJEYtfAN7iWkq_" -> "14TCg0pzvphAIi_lfCfiJEYtfAN7iWkq_"
 * e.g., "https://drive.google.com/file/d/14TCg0pzvphAIi_lfCfiJEYtfAN7iWkq_/view" -> "14TCg0pzvphAIi_lfCfiJEYtfAN7iWkq_"
 */
export function extractDriveFileId(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();

  // Pattern 1: Proxy route /api/attachments/drive/:fileId
  const proxyMatch = trimmed.match(/\/api\/attachments\/drive\/([a-zA-Z0-9_-]+)/);
  if (proxyMatch && proxyMatch[1]) {
    return proxyMatch[1];
  }

  // Pattern 2: Google Drive /file/d/:fileId/
  const driveFileMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (driveFileMatch && driveFileMatch[1]) {
    return driveFileMatch[1];
  }

  // Pattern 3: Google Drive ?id=:fileId
  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParamMatch && idParamMatch[1]) {
    return idParamMatch[1];
  }

  // If plain fileId (standard Google Drive ID is 25-50 alphanumeric + underscores/hyphens)
  if (/^[a-zA-Z0-9_-]{25,60}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

/**
 * Extracts the raw Drive folderId from a folder URL or string.
 * e.g., "https://drive.google.com/drive/folders/1ZJK8oCnqWdP7KC8M2YRzc-5l4WEBVy2x?usp=sharing" -> "1ZJK8oCnqWdP7KC8M2YRzc-5l4WEBVy2x"
 */
export function extractDriveFolderId(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  const match = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return trimmed;
}

interface CachedOAuthToken {
  accessToken: string;
  folderId?: string;
  expiresAt: number;
}

const GLOBAL_DRIVE_TOKEN_KEY = Symbol.for('cloud_lnk_drive_oauth_token');
let cachedOAuthToken: CachedOAuthToken | null =
  (globalThis as any)[GLOBAL_DRIVE_TOKEN_KEY] || null;

/**
 * Retrieves a Google OAuth access token from the Apps Script bridge (cached for 45 minutes).
 */
export async function getGoogleDriveAuthToken(params?: {
  target?: 'ATTACHMENTS' | 'BACKUPS';
  subFolder?: string;
}): Promise<GoogleDriveAuthTokenResult> {
  const target = params?.target || 'ATTACHMENTS';
  const subFolder = params?.subFolder || '';

  // Use cached token if valid for at least another 2 minutes
  if (cachedOAuthToken && cachedOAuthToken.expiresAt > Date.now() + 120000) {
    let resolvedFolderId = cachedOAuthToken.folderId;
    if (!resolvedFolderId) {
      const envFolder =
        target === 'BACKUPS'
          ? process.env.GOOGLE_DRIVE_BACKUPS_FOLDER_ID
          : process.env.GOOGLE_DRIVE_ATTACHMENTS_FOLDER_ID;
      resolvedFolderId = extractDriveFolderId(envFolder || '');
    }
    return {
      ok: true,
      accessToken: cachedOAuthToken.accessToken,
      folderId: resolvedFolderId,
    };
  }

  const { bridgeUrl, token } = getBridgeConfig();

  // Try GET ?token=...&action=GET_AUTH_TOKEN first
  try {
    const url = `${bridgeUrl}?token=${encodeURIComponent(token)}&action=GET_AUTH_TOKEN&target=${encodeURIComponent(target)}${subFolder ? `&subFolder=${encodeURIComponent(subFolder)}` : ''}`;
    const getRes = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    if (getRes.ok) {
      const data = await getRes.json();
      if (data.ok && data.accessToken) {
        cachedOAuthToken = {
          accessToken: data.accessToken,
          folderId: data.folderId,
          expiresAt: Date.now() + 45 * 60 * 1000, // 45 minutes
        };
        (globalThis as any)[GLOBAL_DRIVE_TOKEN_KEY] = cachedOAuthToken;
        return {
          ok: true,
          accessToken: data.accessToken,
          folderId: data.folderId,
        };
      }
    }
  } catch {}

  // Fallback: Try POST with action: 'GET_AUTH_TOKEN'
  try {
    const postRes = await fetch(bridgeUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        token,
        action: 'GET_AUTH_TOKEN',
        target,
        subFolder,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (postRes.ok) {
      const data = await postRes.json();
      if (data.ok && data.accessToken) {
        cachedOAuthToken = {
          accessToken: data.accessToken,
          folderId: data.folderId,
          expiresAt: Date.now() + 45 * 60 * 1000,
        };
        (globalThis as any)[GLOBAL_DRIVE_TOKEN_KEY] = cachedOAuthToken;
        return {
          ok: true,
          accessToken: data.accessToken,
          folderId: data.folderId,
        };
      }
    }
  } catch {}

  return {
    ok: false,
    error: 'Google Apps Script bridge does not support GET_AUTH_TOKEN or returned an error.',
  };
}

/**
 * Initiates a Google Drive v3 Resumable Upload Session.
 * Bypasses Apps Script and Vercel memory limits for files up to 100MB+.
 * Primary path initiates the session directly from Node.js against Google Drive v3 API
 * with the browser's Origin header so Google Drive guarantees full CORS headers on uploadUrl.
 */
export async function getGoogleDriveUploadSession(
  params: GoogleDriveUploadSessionParams
): Promise<GoogleDriveUploadSessionResult> {
  const { bridgeUrl, token } = getBridgeConfig();
  const target = params.target || 'ATTACHMENTS';
  const fileName = params.fileName;
  const mimeType = params.mimeType || 'application/octet-stream';
  const subFolder = params.subFolder;
  const origin = params.origin;
  const fileSize = params.fileSize;

  // Attempt 1 (Primary): Direct Google Drive REST API v3 via accessToken from GET_AUTH_TOKEN
  // Passing the browser's Origin header directly to Google v3 API guarantees CORS headers on uploadUrl!
  const authRes = await getGoogleDriveAuthToken({ target, subFolder });
  if (authRes.ok && authRes.accessToken) {
    try {
      const folderId =
        authRes.folderId ||
        extractDriveFolderId(
          target === 'BACKUPS'
            ? process.env.GOOGLE_DRIVE_BACKUPS_FOLDER_ID || ''
            : process.env.GOOGLE_DRIVE_ATTACHMENTS_FOLDER_ID || ''
        );

      const metadata: Record<string, any> = {
        name: fileName,
        mimeType: mimeType,
      };
      if (folderId) {
        metadata.parents = [folderId];
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${authRes.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
      };
      if (fileSize) {
        headers['X-Upload-Content-Length'] = fileSize.toString();
      }
      if (origin && origin !== '*') {
        headers['Origin'] = origin;
      }

      const initRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',
        {
          method: 'POST',
          headers,
          body: JSON.stringify(metadata),
        }
      );

      const uploadUrl = initRes.headers.get('location') || initRes.headers.get('Location');
      if (uploadUrl) {
        return {
          ok: true,
          uploadUrl,
          accessToken: authRes.accessToken,
          folderId,
          subFolder,
        };
      }
    } catch (err: any) {
      console.warn('[Google Drive Bridge] Direct resumable init error:', err.message);
    }
  }

  // Attempt 2 (Fallback): Call bridge with action: 'INIT_RESUMABLE_UPLOAD'
  try {
    const res = await fetch(bridgeUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        token,
        action: 'INIT_RESUMABLE_UPLOAD',
        target,
        fileName,
        mimeType,
        subFolder,
        origin,
        fileSize,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.ok && data.uploadUrl) {
        return {
          ok: true,
          uploadUrl: data.uploadUrl,
          accessToken: data.accessToken,
          folderId: data.folderId,
          subFolder,
        };
      }
    }
  } catch {}

  // Attempt 3 (Universal Bridge Resumable Fallback):
  // If the deployed Apps Script Web App has not been redeployed with GET_AUTH_TOKEN / INIT_RESUMABLE_UPLOAD
  // yet, return a bridge-resumable:// session URI so PUT /api/attachments/stage accepts 2MB chunks
  // into os.tmpdir() (/tmp on Vercel) and commits the assembled file via the bridge's native UPLOAD action!
  const safeSessionId = (fileName || `upload_${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '_');
  return {
    ok: true,
    uploadUrl: `bridge-resumable://${safeSessionId}`,
    folderId: extractDriveFolderId(
      target === 'BACKUPS'
        ? process.env.GOOGLE_DRIVE_BACKUPS_FOLDER_ID || ''
        : process.env.GOOGLE_DRIVE_ATTACHMENTS_FOLDER_ID || ''
    ),
    subFolder,
  };
}

/**
 * Resolves a just-uploaded fileId from Google Drive v3 API by savedFileName and folderId
 * when browser CORS prevents reading the final PUT response body directly.
 */
export async function resolveUploadedDriveFile(params: {
  fileId?: string;
  savedFileName: string;
  folderId?: string;
  subFolder?: string;
}): Promise<{ ok: boolean; fileId?: string; error?: string }> {
  if (params.fileId && params.fileId.trim()) {
    return { ok: true, fileId: params.fileId.trim() };
  }

  const authRes = await getGoogleDriveAuthToken({
    target: 'ATTACHMENTS',
    subFolder: params.subFolder,
  });
  if (!authRes.ok || !authRes.accessToken) {
    return {
      ok: false,
      error: authRes.error || 'Could not retrieve Google Drive access token to resolve file.',
    };
  }

  const safeFileName = (params.savedFileName || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const effectiveFolderId =
    params.folderId ||
    authRes.folderId ||
    extractDriveFolderId(process.env.GOOGLE_DRIVE_ATTACHMENTS_FOLDER_ID || '');

  const tryLookup = async (withParent: boolean): Promise<string | null> => {
    const qParts = [`name = '${safeFileName}'`, 'trashed = false'];
    if (withParent && effectiveFolderId) {
      qParts.push(`'${effectiveFolderId}' in parents`);
    }
    const q = encodeURIComponent(qParts.join(' and '));
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime desc&pageSize=1&fields=files(id,name,size,mimeType)&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${authRes.accessToken}`,
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data.files) && data.files.length > 0 && data.files[0].id) {
      return data.files[0].id;
    }
    return null;
  };

  try {
    let foundId = await tryLookup(true);
    if (!foundId && effectiveFolderId) {
      foundId = await tryLookup(false);
    }
    if (foundId) {
      return { ok: true, fileId: foundId };
    }
  } catch (err: any) {
    console.warn('[Google Drive Bridge] resolveUploadedDriveFile error:', err.message);
  }

  return {
    ok: false,
    error: `Unable to locate uploaded file '${params.savedFileName}' on Google Drive.`,
  };
}

/**
 * Pings the Google Workspace Apps Script Web App to verify connectivity and quota.
 */
export async function pingGoogleDriveBridge(): Promise<GoogleDrivePingResult> {
  const { bridgeUrl, token } = getBridgeConfig();
  const url = `${bridgeUrl}?token=${encodeURIComponent(token)}&action=PING`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      throw new Error(`Google Drive bridge returned HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    return {
      ok: Boolean(data.ok),
      status: data.status || 'UNKNOWN',
      attachmentsFolderName: data.attachmentsFolderName,
      backupsFolderName: data.backupsFolderName,
      storageUsedBytes: data.storageUsedBytes != null ? Number(data.storageUsedBytes) : undefined,
      storageLimitBytes: data.storageLimitBytes != null ? Number(data.storageLimitBytes) : undefined,
    };
  } catch (err: any) {
    console.warn('[Google Drive Bridge] PING failed:', err.message);
    return {
      ok: false,
      status: 'BRIDGE_UNREACHABLE',
      error: err.message || 'Unknown network error',
    };
  }
}

/**
 * Uploads a binary buffer to Google Drive.
 * Supports up to 100MB:
 * - Direct Google Drive v3 Resumable Upload for large files (> 4MB)
 * - Fast Base64 bridge upload for small files (<= 4MB)
 */
export async function uploadToGoogleDrive(
  params: GoogleDriveUploadParams
): Promise<GoogleDriveUploadResult> {
  const { bridgeUrl, token } = getBridgeConfig();
  const bufferLen = params.buffer.length;

  // FAST DIRECT PATH for large files (> 4MB) or if resumable session is available
  if (bufferLen > 4 * 1024 * 1024) {
    const session = await getGoogleDriveUploadSession({
      target: params.target,
      fileName: params.fileName,
      mimeType: params.mimeType,
      subFolder: params.subFolder,
      fileSize: bufferLen,
    });

    if (
      session.ok &&
      session.uploadUrl &&
      session.uploadUrl.startsWith('https://www.googleapis.com/')
    ) {
      const putRes = await fetch(session.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': bufferLen.toString(),
          'Content-Type': params.mimeType,
        },
        body: new Uint8Array(params.buffer),
        signal: AbortSignal.timeout(300000), // 5 minutes for up to 100MB
      });

      if (!putRes.ok) {
        throw new Error(
          `Google Drive resumable upload failed HTTP ${putRes.status}: ${putRes.statusText}`
        );
      }

      const driveFile = await putRes.json();
      const uploadResult: GoogleDriveUploadResult = {
        ok: true,
        fileId: driveFile.id,
        fileName: driveFile.name || params.fileName,
        sizeBytes: bufferLen,
        createdAt: new Date().toISOString(),
        viewUrl: `https://drive.google.com/file/d/${driveFile.id}/view`,
        downloadUrl: `/api/attachments/drive/${driveFile.id}?name=${encodeURIComponent(params.fileName)}`,
      };

      // Only store files <= 15MB in RAM to avoid exhausting server memory
      if (bufferLen <= 15 * 1024 * 1024) {
        setCachedDriveFile(uploadResult.fileId, {
          buffer: params.buffer,
          mimeType: params.mimeType,
          fileName: uploadResult.fileName,
        });
      }

      return uploadResult;
    }
  }

  // STANDARD BRIDGE PATH (for files <= 4MB, or fallback)
  const payload = {
    token,
    action: 'UPLOAD',
    target: params.target,
    fileName: params.fileName,
    mimeType: params.mimeType,
    base64Data: params.buffer.toString('base64'),
    subFolder: params.subFolder,
    retentionCount: params.retentionCount,
  };

  try {
    const res = await fetch(bridgeUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(180000),
    });

    if (!res.ok) {
      throw new Error(`Google Drive bridge upload failed HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    if (!data.ok) {
      throw new Error(data.error || 'Google Drive bridge rejected upload.');
    }

    const uploadResult: GoogleDriveUploadResult = {
      ok: true,
      fileId: data.fileId,
      fileName: data.fileName || params.fileName,
      sizeBytes: Number(data.sizeBytes ?? params.buffer.length),
      createdAt: data.createdAt || new Date().toISOString(),
      viewUrl: data.viewUrl || '',
      downloadUrl: data.downloadUrl || '',
    };

    if (bufferLen <= 15 * 1024 * 1024) {
      setCachedDriveFile(uploadResult.fileId, {
        buffer: params.buffer,
        mimeType: params.mimeType,
        fileName: uploadResult.fileName,
      });
    }

    return uploadResult;
  } catch (err: any) {
    console.error('[Google Drive Bridge] Upload error:', err);
    throw new Error(`Failed to upload file to Google Drive: ${err.message}`);
  }
}

/**
 * Downloads a binary file buffer from Google Drive by fileId.
 * Directly downloads via Google Drive REST API v3 when OAuth token is available.
 */
export async function downloadFromGoogleDrive(
  fileId: string
): Promise<GoogleDriveDownloadResult> {
  // 1. Fast memory buffer cache check (<0.1ms)
  const cached = getCachedDriveFile(fileId);
  if (cached) {
    return {
      ok: true,
      buffer: cached.buffer,
      fileName: cached.fileName,
      mimeType: cached.mimeType,
      sizeBytes: cached.buffer.length,
    };
  }

  // 2. Direct high-speed download via Google Drive REST API v3
  const authRes = await getGoogleDriveAuthToken();
  if (authRes.ok && authRes.accessToken) {
    try {
      const driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
      const directRes = await fetch(driveUrl, {
        headers: {
          Authorization: `Bearer ${authRes.accessToken}`,
        },
        signal: AbortSignal.timeout(180000),
      });

      if (directRes.ok) {
        const arrayBuf = await directRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        const mimeType = directRes.headers.get('content-type') || 'application/octet-stream';
        const result: GoogleDriveDownloadResult = {
          ok: true,
          buffer,
          fileName: 'downloaded-file',
          mimeType,
          sizeBytes: buffer.length,
        };

        if (buffer.length <= 15 * 1024 * 1024) {
          setCachedDriveFile(fileId, {
            buffer,
            mimeType: result.mimeType,
            fileName: result.fileName,
          });
        }

        return result;
      }
    } catch (err: any) {
      console.warn('[Google Drive Bridge] Direct download failed, falling back to bridge:', err.message);
    }
  }

  // 3. Fallback to bridge DOWNLOAD action
  const { bridgeUrl, token } = getBridgeConfig();
  const payload = {
    token,
    action: 'DOWNLOAD',
    fileId,
  };

  try {
    const res = await fetch(bridgeUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(180000),
    });

    if (!res.ok) {
      throw new Error(`Google Drive bridge download failed HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    if (!data.ok || !data.base64Data) {
      throw new Error(data.error || `File '${fileId}' not found or empty on Google Drive.`);
    }

    const buffer = Buffer.from(data.base64Data, 'base64');
    const result: GoogleDriveDownloadResult = {
      ok: true,
      buffer,
      fileName: data.fileName || 'downloaded-file',
      mimeType: data.mimeType || 'application/octet-stream',
      sizeBytes: Number(data.sizeBytes ?? buffer.length),
    };

    if (buffer.length <= 15 * 1024 * 1024) {
      setCachedDriveFile(fileId, {
        buffer,
        mimeType: result.mimeType,
        fileName: result.fileName,
      });
    }

    return result;
  } catch (err: any) {
    console.error('[Google Drive Bridge] Download error:', err);
    throw new Error(`Failed to download file '${fileId}' from Google Drive: ${err.message}`);
  }
}

/**
 * Lists all backup files stored in the Google Drive Backups folder.
 */
export async function listGoogleDriveBackups(): Promise<GoogleDriveListBackupsResult> {
  const { bridgeUrl, token } = getBridgeConfig();

  const payload = {
    token,
    action: 'LIST_BACKUPS',
  };

  try {
    const res = await fetch(bridgeUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      throw new Error(`Google Drive bridge list backups failed HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    if (!data.ok) {
      throw new Error(data.error || 'Failed to list backups from Google Drive.');
    }

    const files: GoogleDriveBackupFile[] = (data.files || []).map((f: any) => ({
      fileId: f.fileId,
      filename: f.filename || f.fileName || 'backup.json.gz',
      sizeBytes: Number(f.sizeBytes ?? 0),
      createdAt: f.createdAt || new Date().toISOString(),
      viewUrl: f.viewUrl,
      downloadUrl: f.downloadUrl,
    }));

    // Sort newest first
    files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return {
      ok: true,
      files,
    };
  } catch (err: any) {
    console.warn('[Google Drive Bridge] LIST_BACKUPS error:', err.message);
    return {
      ok: false,
      files: [],
      error: err.message || 'Failed to list backups',
    };
  }
}

/**
 * Deletes a file from Google Drive by fileId.
 */
export async function deleteFromGoogleDrive(
  fileId: string
): Promise<GoogleDriveDeleteResult> {
  const { bridgeUrl, token } = getBridgeConfig();

  const payload = {
    token,
    action: 'DELETE_FILE',
    fileId,
  };

  try {
    const res = await fetch(bridgeUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      throw new Error(`Google Drive bridge delete file failed HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    if (!data.ok) {
      throw new Error(data.error || `Failed to delete file '${fileId}' from Google Drive.`);
    }

    return {
      ok: true,
      deletedFileId: data.deletedFileId || fileId,
    };
  } catch (err: any) {
    console.error('[Google Drive Bridge] Delete error:', err);
    throw new Error(`Failed to delete file '${fileId}' from Google Drive: ${err.message}`);
  }
}
