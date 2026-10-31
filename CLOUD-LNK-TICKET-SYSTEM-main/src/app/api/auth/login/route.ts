import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { createSession, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from '@/lib/auth/session';
import { checkRateLimit, resetRateLimit } from '@/lib/security/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const ipAddress = request.headers.get('x-forwarded-for') || '127.0.0.1';
    const body = await request.json().catch(() => ({}));
    const { email, identifier, password } = body;
    const rawId = email || identifier;

    if (!rawId || !password) {
      return NextResponse.json(
        { error: 'Email/username and password are required.' },
        { status: 400 }
      );
    }

    const trimmedIdentifier = String(rawId).trim().toLowerCase();
    const rateLimitKey = `auth_login:${ipAddress}:${trimmedIdentifier}`;

    // Rate limit: max 5 login attempts per 5 minutes per IP & user
    const rateLimit = checkRateLimit(rateLimitKey, {
      intervalMs: 5 * 60 * 1000,
      maxRequests: 5,
    });

    if (!rateLimit.success) {
      return NextResponse.json(
        {
          error: `Too many failed login attempts. Please wait ${rateLimit.retryAfterSeconds} seconds before trying again.`,
          retryAfter: rateLimit.retryAfterSeconds,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
        }
      );
    }

    // Support logging in via email address or username
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: trimmedIdentifier },
          { username: trimmedIdentifier },
        ],
      },
      include: {
        spaceMemberships: {
          select: { spaceId: true },
        },
      },
    });

    if (!user) {
      await prisma.auditLog.create({
        data: {
          event: 'LOGIN_FAILED_USER_NOT_FOUND',
          resourceType: 'User',
          ipAddress,
          details: JSON.stringify({ identifier: trimmedIdentifier }),
        },
      }).catch(() => {});

      return NextResponse.json(
        { error: 'Invalid email/username or password.' },
        { status: 401 }
      );
    }

    // Check account active status
    if (!user.isActive) {
      return NextResponse.json(
        { error: 'Your account has been deactivated. Please contact your company administrator.' },
        { status: 403 }
      );
    }

    // Verify bcrypt hash
    const isPasswordValid = await bcrypt.compare(String(password), user.passwordHash);
    if (!isPasswordValid) {
      await prisma.auditLog.create({
        data: {
          event: 'LOGIN_FAILED_INVALID_PASSWORD',
          resourceType: 'User',
          resourceId: user.id,
          userId: user.id,
          ipAddress,
          details: JSON.stringify({ username: user.username }),
        },
      }).catch(() => {});

      return NextResponse.json(
        { error: 'Invalid email/username or password.' },
        { status: 401 }
      );
    }

    // Reset rate limiter on successful authentication
    resetRateLimit(rateLimitKey);

    // Create 64-character random session token
    const session = await createSession(user.id);

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        globalRole: user.globalRole,
        assignedSpaceIds: user.spaceMemberships.map((m: { spaceId: string }) => m.spaceId),
      },
    });

    // Set secure, HTTP-Only, SameSite=Lax cookie
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: session.token,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
      // For local intranet HTTP, secure is false unless HTTPS is configured
      secure: process.env.NODE_ENV === 'production' && request.nextUrl.protocol === 'https:',
    });

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'An unexpected internal error occurred during authentication.' },
      { status: 500 }
    );
  }
}
