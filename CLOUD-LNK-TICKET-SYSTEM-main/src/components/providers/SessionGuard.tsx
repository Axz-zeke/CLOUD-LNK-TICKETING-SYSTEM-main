'use client';

import { useEffect } from 'react';

/**
 * SessionGuard
 * Enforces client-side session invalidation:
 * 1. Global fetch interceptor to catch any 401 Unauthorized API response and immediately force a redirect to /login.
 * 2. Window focus / visibility-change heartbeat to check /api/auth/me when the user returns to the tab.
 * 3. Periodic polling (every 30s) to detect revoked sessions in real-time even without active user clicks.
 */
export function SessionGuard({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 1. Intercept window.fetch to catch 401s across all components
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);

      if (response.status === 401 && window.location.pathname !== '/login') {
        const rawUrl = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url || '';
        // Do not intercept failed login credentials from the login form
        if (!rawUrl.includes('/api/auth/login')) {
          console.warn('[SessionGuard] 401 Unauthorized detected from API. Redirecting to /login...');
          window.location.href = '/login';
        }
      }

      return response;
    };

    // 2. Tab focus / visibility change verification
    const verifyActiveSession = async () => {
      if (window.location.pathname === '/login') return;

      try {
        const res = await originalFetch('/api/auth/me', { cache: 'no-store' });
        if (res.status === 401) {
          console.warn('[SessionGuard] Session revoked in database. Redirecting to /login...');
          window.location.href = '/login';
        }
      } catch {
        // Network drop; do not aggressively bounce on offline LAN glitches
      }
    };

    const handleVisibilityOrFocus = () => {
      if (!document.hidden) {
        verifyActiveSession();
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    // 3. Periodic check every 30 seconds
    const interval = setInterval(verifyActiveSession, 30000);

    return () => {
      window.fetch = originalFetch;
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      clearInterval(interval);
    };
  }, []);

  return <>{children}</>;
}
