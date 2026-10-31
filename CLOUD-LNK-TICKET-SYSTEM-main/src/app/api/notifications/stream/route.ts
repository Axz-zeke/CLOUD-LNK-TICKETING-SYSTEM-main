import { NextRequest, NextResponse } from 'next/server';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { registerClient } from '@/lib/sse-broker';

import { checkRateLimit } from '@/lib/security/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getAuthenticatedUser(request: NextRequest) {
  let token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authHeader = request.headers.get('authorization');
  if (!token && authHeader?.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  // Deprecated fallback query param ?token= (warning: query params may be exposed in HTTP access logs)
  if (!token) {
    const url = new URL(request.url);
    const queryToken = url.searchParams.get('token');
    if (queryToken) {
      token = queryToken;
    }
  }

  if (!token) {
    return { error: 'Unauthorized: Authentication required.', status: 401 as const };
  }

  const sessionData = await validateSession(token);
  if (!sessionData) {
    return { error: 'Unauthorized: Session is expired or invalid.', status: 401 as const };
  }

  return { user: sessionData.user };
}

/**
 * GET /api/notifications/stream
 * Establishes a persistent Server-Sent Events (SSE) connection for real-time notification alerts.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user } = auth;

    // Throttle SSE connection frequency per user/IP to mitigate socket exhaustion attacks
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown-ip';
    const rateLimit = checkRateLimit(`sse-conn:${user.id}:${ip}`, { maxRequests: 20, windowMs: 60 * 1000 });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many stream connection attempts. Please wait.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
      );
    }
    let unregister: (() => void) | null = null;
    let pingInterval: NodeJS.Timeout | null = null;

    const stream = new ReadableStream({
      start(controller) {
        unregister = registerClient(user.id, controller);

        const encoder = new TextEncoder();

        // Send initial connection event
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'connected', userId: user.id })}\n\n`)
          );
        } catch {
          // Client closed immediately
        }

        // Keep-alive ping every 25 seconds to keep proxies/firewalls alive
        pingInterval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': ping\n\n'));
          } catch {
            if (pingInterval) clearInterval(pingInterval);
          }
        }, 25000);
      },
      cancel() {
        if (pingInterval) clearInterval(pingInterval);
        if (unregister) unregister();
      },
    });

    // Handle connection abort from client disconnect
    request.signal.addEventListener('abort', () => {
      if (pingInterval) clearInterval(pingInterval);
      if (unregister) unregister();
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('Failed to initialize SSE notifications stream:', error);
    return NextResponse.json(
      { error: 'An unexpected internal error occurred while opening notification stream.' },
      { status: 500 }
    );
  }
}
