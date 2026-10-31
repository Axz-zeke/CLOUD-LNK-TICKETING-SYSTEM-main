'use client';

import React, { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { AuthenticatedUser } from '@/lib/security/rbac';
import { RefreshCw } from 'lucide-react';

export default function HomePage() {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Hard redirect helper to escape any Next.js soft-navigation or router stalls
  const redirectToLogin = () => {
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  };

  // Safety fallback timeout: if session loading takes more than 3 seconds without a user, force hard redirect
  useEffect(() => {
    const timer = setTimeout(() => {
      if (loading && !user) {
        console.warn('Session verification exceeded 3000ms threshold, forcing hard redirect to /login');
        redirectToLogin();
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [loading, user]);

  // If loading finishes and no user is present, immediately redirect
  useEffect(() => {
    if (!loading && !user) {
      redirectToLogin();
    }
  }, [loading, user]);

  useEffect(() => {
    let isMounted = true;

    async function checkAuth() {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!res.ok) {
          // If 401 or any non-OK response, immediately force hard redirect to /login
          redirectToLogin();
          return;
        }

        const data = await res.json();

        // Handle both { user: ... } and direct user object responses:
        const activeUser = data?.user ?? (data?.id ? data : null);

        if (activeUser) {
          if (isMounted) {
            setUser(activeUser);
          }
        } else {
          console.warn('No user object found in auth/me response, redirecting to /login');
          redirectToLogin();
        }
      } catch (err) {
        console.warn('Session verification fallback, redirecting to /login:', err);
        redirectToLogin();
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    checkAuth();

    return () => {
      isMounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-zinc-400 gap-3 font-sans antialiased">
        <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
        <p className="text-xs font-mono tracking-wider text-zinc-500 uppercase">
          Initializing Workspace...
        </p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-zinc-400 gap-3 font-sans antialiased">
        <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
        <p className="text-xs font-mono tracking-wider text-zinc-500 uppercase">
          Redirecting to authentication portal...
        </p>
        <a
          href="/login"
          className="text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors mt-2"
        >
          Click here if you are not automatically redirected
        </a>
      </div>
    );
  }

  return <AppShell user={user} />;
}
