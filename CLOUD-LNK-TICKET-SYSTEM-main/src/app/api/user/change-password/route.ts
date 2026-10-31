import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';

import { checkRateLimit } from '@/lib/security/rate-limit';

async function getAuthenticatedUser(request: NextRequest) {
  let token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authHeader = request.headers.get('authorization');
  if (!token && authHeader?.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  if (!token) {
    return { error: 'Unauthorized: Authentication required.', status: 401 as const };
  }

  const sessionData = await validateSession(token);
  if (!sessionData) {
    return { error: 'Unauthorized: Session is expired or invalid.', status: 401 as const };
  }

  return { user: sessionData.user, token: sessionData.session.token };
}

/**
 * POST /api/user/change-password
 * Allows any authenticated user to securely update their local LAN account password.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user, token } = auth;

    // Rate limiting: max 5 attempts per 5 minutes per user/IP to mitigate brute-force verification
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown-ip';
    const rateLimit = checkRateLimit(`change-pw:${user.id}:${ip}`, { maxRequests: 5, windowMs: 5 * 60 * 1000 });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many password change attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: 'Both current password and new password are required.' },
        { status: 400 }
      );
    }

    // Fetch user record with existing password hash
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        username: true,
        passwordHash: true,
      },
    });

    if (!dbUser) {
      return NextResponse.json({ error: 'User account not found.' }, { status: 404 });
    }

    // Verify current password matches stored bcrypt hash
    const isMatch = await bcrypt.compare(currentPassword, dbUser.passwordHash);
    if (!isMatch) {
      try {
        await prisma.auditLog.create({
          data: {
            event: 'USER_PASSWORD_CHANGE_FAILED',
            userId: user.id,
            resourceType: 'User',
            resourceId: user.id,
            details: `Failed password change attempt for user ${user.username} (incorrect current password)`,
          },
        });
      } catch {}

      return NextResponse.json(
        { error: 'Current password does not match' },
        { status: 400 }
      );
    }

    // Verify minimum length requirement
    if (newPassword.length < 6) {
      return NextResponse.json(
        { error: 'New password must be at least 6 characters long' },
        { status: 400 }
      );
    }

    // Generate new password hash with 10 salt rounds
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newPasswordHash },
    });

    // Invalidate all other active sessions for this user across all devices/browsers
    try {
      await prisma.session.deleteMany({
        where: {
          userId: user.id,
          token: { not: token },
        },
      });
    } catch (sessionErr) {
      console.error('Failed to revoke other user sessions on password change:', sessionErr);
    }

    // Record audit log
    try {
      await prisma.auditLog.create({
        data: {
          event: 'USER_PASSWORD_CHANGED',
          userId: user.id,
          resourceType: 'User',
          resourceId: user.id,
          details: `User ${user.username} changed their local password and revoked other active sessions`,
        },
      });
    } catch (auditErr) {
      console.error('Failed to write audit log for password change:', auditErr);
    }

    return NextResponse.json({
      message: 'Password updated successfully and other sessions revoked.',
    });
  } catch (error) {
    console.error('Password change error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Internal server error while changing password.',
      },
      { status: 500 }
    );
  }
}
