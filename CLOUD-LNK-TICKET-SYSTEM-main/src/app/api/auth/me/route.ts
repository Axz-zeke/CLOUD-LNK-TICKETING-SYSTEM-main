import { NextRequest, NextResponse } from 'next/server';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';

export async function GET(request: NextRequest) {
  try {
    // Check both cookie and Bearer authorization header
    let token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    const authHeader = request.headers.get('authorization');
    if (!token && authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }

    if (!token) {
      const res = NextResponse.json(
        { error: 'Unauthorized: Authentication required.' },
        { status: 401 }
      );
      res.cookies.set({
        name: SESSION_COOKIE_NAME,
        value: '',
        path: '/',
        maxAge: 0,
      });
      return res;
    }

    const sessionData = await validateSession(token);
    if (!sessionData) {
      const res = NextResponse.json(
        { error: 'Unauthorized: Session is expired or invalid.' },
        { status: 401 }
      );
      res.cookies.set({
        name: SESSION_COOKIE_NAME,
        value: '',
        path: '/',
        maxAge: 0,
      });
      return res;
    }

    return NextResponse.json({
      user: sessionData.user,
      assignedSpaceIds: sessionData.assignedSpaceIds,
      expiresAt: sessionData.session.expiresAt,
    });
  } catch (error) {
    console.error('Auth check error:', error);
    return NextResponse.json(
      { error: 'Failed to verify session status.' },
      { status: 500 }
    );
  }
}
