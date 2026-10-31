import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const SESSION_COOKIE_NAME = 'lan_session_token';

// Routes that can be accessed without session cookie (they handle their own auth or are public)
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/health', '/api/cron/backup'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static assets, Next.js internal files, and favicon
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/uploads') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  const isPublicPath = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  // Public paths are completely excluded from session checks and must never be redirected
  if (isPublicPath) {
    return NextResponse.next();
  }

  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  // If user is accessing a protected page and has no session token, redirect to /login
  if (!sessionToken) {
    // If it's an API route, return 401 Unauthorized JSON instead of redirecting
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Unauthorized: Session token missing or invalid.' },
        { status: 401 }
      );
    }

    const loginUrl = new URL('/login', request.url);
    if (pathname !== '/') {
      loginUrl.searchParams.set('from', pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  // For non-API document page requests, verify against active database sessions
  // so that sessions revoked by password change immediately redirect to /login on page refresh
  if (!pathname.startsWith('/api/')) {
    try {
      const verifyUrl = new URL('/api/auth/me', request.url);
      const verifyRes = await fetch(verifyUrl, {
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
        },
        cache: 'no-store',
      });

      if (!verifyRes.ok) {
        const loginUrl = new URL('/login', request.url);
        if (pathname !== '/') {
          loginUrl.searchParams.set('from', pathname);
        }
        const redirectRes = NextResponse.redirect(loginUrl);
        redirectRes.cookies.set({
          name: SESSION_COOKIE_NAME,
          value: '',
          path: '/',
          maxAge: 0,
        });
        return redirectRes;
      }
    } catch (err) {
      console.warn('[Middleware] Session verification error:', err);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
