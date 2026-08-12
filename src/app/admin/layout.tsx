'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Loader2, Users, FileClock, Activity, BarChart3, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

const NAV_ITEMS = [
  { href: '/admin/users', labelKey: 'admin.users', icon: Users },
  { href: '/admin/models', labelKey: 'admin.models', icon: Cpu },
  { href: '/admin/stats', labelKey: 'admin.stats', icon: BarChart3 },
  { href: '/admin/logs', labelKey: 'admin.logs', icon: FileClock },
  { href: '/admin/api-logs', labelKey: 'admin.apiLogs', icon: Activity },
];

// 管理后台布局：校验登录 + admin 权限，提供导航入口
export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useT();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        if (!res.ok || !data?.authenticated) {
          router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
          return;
        }
        if (data.user?.role !== 'admin') {
          router.replace('/workflows/editor');
          return;
        }
      } catch {
        router.replace('/login');
      } finally {
        setChecking(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, pathname]);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-4">
          <h1 className="text-base font-semibold">管理后台</h1>
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Button
                  key={item.href}
                  variant="ghost"
                  size="sm"
                  className={cn('gap-1.5', active && 'bg-muted font-medium')}
                  onClick={() => router.push(item.href)}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t(item.labelKey)}
                </Button>
              );
            })}
          </nav>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push('/workflows/editor')}
        >
          返回工作台
        </Button>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
