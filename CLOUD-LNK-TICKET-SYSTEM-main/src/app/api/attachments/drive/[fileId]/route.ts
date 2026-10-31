import { NextRequest, NextResponse } from 'next/server';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import {
  downloadFromGoogleDrive,
  getCachedDriveFile,
  setCachedDriveFile,
  getGoogleDriveAuthToken,
} from '@/lib/google-drive-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await params;
    if (!fileId) {
      return NextResponse.json({ error: 'File ID is required' }, { status: 400 });
    }

    // Authenticate session via cookie or bearer header
    let token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    const authHeader = request.headers.get('authorization');
    if (!token && authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized: Authentication required.' }, { status: 401 });
    }

    const sessionData = await validateSession(token);
    if (!sessionData) {
      return NextResponse.json({ error: 'Unauthorized: Session invalid or expired.' }, { status: 401 });
    }

    const queryName = request.nextUrl.searchParams.get('name') || '';

    // 1. Check shared in-memory buffer cache first (<0.1ms)
    const cached = getCachedDriveFile(fileId);
    if (cached) {
      const isInline =
        cached.mimeType.startsWith('image/') ||
        cached.mimeType === 'application/pdf' ||
        cached.mimeType.startsWith('video/') ||
        cached.mimeType.startsWith('text/');

      const outName = queryName || cached.fileName;
      return new NextResponse(new Uint8Array(cached.buffer), {
        status: 200,
        headers: {
          'Content-Type': cached.mimeType || 'application/octet-stream',
          'Content-Disposition': `${isInline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(outName)}"`,
          'Content-Length': cached.buffer.length.toString(),
          'Cache-Control': 'private, max-age=86400, stale-while-revalidate=3600',
          'X-Drive-Cache': 'HIT',
        },
      });
    }

    // 2. Direct high-speed streaming via Google Drive API v3 (bypasses RAM buffering for 50MB-100MB files!)
    const authRes = await getGoogleDriveAuthToken();
    if (authRes.ok && authRes.accessToken) {
      try {
        const driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
        const driveRes = await fetch(driveUrl, {
          headers: {
            Authorization: `Bearer ${authRes.accessToken}`,
          },
        });

        if (driveRes.ok && driveRes.body) {
          const contentType = driveRes.headers.get('content-type') || 'application/octet-stream';
          const contentLength = driveRes.headers.get('content-length') || undefined;
          const isInline =
            contentType.startsWith('image/') ||
            contentType === 'application/pdf' ||
            contentType.startsWith('video/') ||
            contentType.startsWith('text/');

          const outName = queryName || 'attachment';
          const headers: Record<string, string> = {
            'Content-Type': contentType,
            'Content-Disposition': `${isInline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(outName)}"`,
            'Cache-Control': 'private, max-age=86400, stale-while-revalidate=3600',
            'X-Drive-Cache': 'DIRECT-STREAM',
          };
          if (contentLength) {
            headers['Content-Length'] = contentLength;
          }

          return new NextResponse(driveRes.body as any, {
            status: 200,
            headers,
          });
        }
      } catch (streamErr) {
        console.warn('[Drive Proxy API] Direct stream failed, falling back to downloadFromGoogleDrive:', streamErr);
      }
    }

    // 3. Fallback: Download file buffer from Google Drive via the bridge
    const driveResult = await downloadFromGoogleDrive(fileId);

    const isInline =
      driveResult.mimeType.startsWith('image/') ||
      driveResult.mimeType === 'application/pdf' ||
      driveResult.mimeType.startsWith('video/') ||
      driveResult.mimeType.startsWith('text/');

    const outName = queryName || driveResult.fileName;
    return new NextResponse(new Uint8Array(driveResult.buffer), {
      status: 200,
      headers: {
        'Content-Type': driveResult.mimeType || 'application/octet-stream',
        'Content-Disposition': `${isInline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(outName)}"`,
        'Content-Length': driveResult.buffer.length.toString(),
        'Cache-Control': 'private, max-age=86400, stale-while-revalidate=3600',
        'X-Drive-Cache': 'MISS',
      },
    });
  } catch (error: any) {
    console.error('[Drive Proxy API] Error serving file:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch attachment from Google Drive.' },
      { status: 500 }
    );
  }
}
