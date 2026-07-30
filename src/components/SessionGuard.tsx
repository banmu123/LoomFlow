'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const EXCLUDED_PATHS = [
  '/api/auth/login',
  '/api/auth/me',
  '/api/auth/register',
  '/api/auto-login',
  '/api/auth/callback',
  '/api/auth/feishu',
];

export function SessionGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const url = typeof args[0] === 'string' ? args[0] : (args[0] instanceof URL ? args[0].href : (args[0] as Request)?.url);
      if (response.status === 401 && url && !EXCLUDED_PATHS.some((p) => url.includes(p))) {
        const currentPath = window.location.pathname;
        router.push(`/login?redirect=${encodeURIComponent(currentPath)}`);
      }
      return response;
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, [router]);

  return <>{children}</>;
}
