/**
 * In-Memory Sliding Window Rate Limiter
 * Suitable for local intranet / single-node Next.js deployment.
 * Protects authentication, password changes, file uploads, and AI synthesis from DoS & brute-force.
 */

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();

// Periodically clean expired keys every 5 minutes to prevent memory leak
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitStore.entries()) {
      if (now > record.resetAt) {
        rateLimitStore.delete(key);
      }
    }
  }, 5 * 60 * 1000).unref?.();
}

export interface RateLimitOptions {
  intervalMs?: number; // Time window in milliseconds
  windowMs?: number; // Alias for intervalMs
  maxRequests: number; // Max allowed attempts per window
}

export interface RateLimitResult {
  success: boolean;
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

/**
 * Check and increment rate limit counter for a specific key (e.g. `login:192.168.1.5:user`).
 */
export function checkRateLimit(
  key: string,
  options: RateLimitOptions = { intervalMs: 60 * 1000, maxRequests: 10 }
): RateLimitResult {
  const windowTime = options.intervalMs ?? options.windowMs ?? 60 * 1000;
  const now = Date.now();
  const existing = rateLimitStore.get(key);

  if (!existing || now > existing.resetAt) {
    const record: RateLimitRecord = {
      count: 1,
      resetAt: now + windowTime,
    };
    rateLimitStore.set(key, record);
    return {
      success: true,
      allowed: true,
      limit: options.maxRequests,
      remaining: options.maxRequests - 1,
      resetAt: record.resetAt,
      retryAfterSeconds: Math.ceil(windowTime / 1000),
    };
  }

  if (existing.count >= options.maxRequests) {
    const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return {
      success: false,
      allowed: false,
      limit: options.maxRequests,
      remaining: 0,
      resetAt: existing.resetAt,
      retryAfterSeconds: retryAfter,
    };
  }

  existing.count += 1;
  const remaining = Math.max(0, options.maxRequests - existing.count);
  return {
    success: true,
    allowed: true,
    limit: options.maxRequests,
    remaining,
    resetAt: existing.resetAt,
    retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
  };
}

/**
 * Reset rate limit counter on successful action (e.g. successful login)
 */
export function resetRateLimit(key: string): void {
  rateLimitStore.delete(key);
}
