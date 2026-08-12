'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Loader2, Users, FileClock, Activity, BarChart3, Cpu, LogOut, ArrowLeft, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

const NAV_ITEMS = [
  { href: '/admin/users', labelKey: 'admin.users', icon: Users },
  { href: '/admin/stats', labelKey: 'admin.stats', icon: BarChart3 },
  { href: '/admin/logs', labelKey: 'admin.logs', icon: FileClock },
  { href: '/admin/api-logs', labelKey: 'admin.apiLogs', icon: Activity },
  { href: '/admin/models', labelKey: 'admin.models', icon: Cpu },
];

// 管理后台布局：左侧侧边菜单 + 底部用户信息
export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useT();
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState('');

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
        setUsername(data.user?.username || '');
      } catch {
        router.replace('/login');
      } finally {
        setChecking(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, pathname]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    router.push('/login');
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* 左侧侧边菜单 */}
      <aside className="flex w-[200px] shrink-0 flex-col border-r border-border bg-card">
        {/* Logo */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
            <Shield className="h-4 w-4 text-primary" />
          </div>
          <span className="text-sm font-semibold">{t('admin.title')}</span>
        </div>

        {/* 菜单 */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors',
                  active
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{t(item.labelKey)}</span>
              </button>
            );
          })}
        </nav>

        {/* 底部：用户信息 + 返回 + 退出 */}
        <div className="space-y-1 border-t border-border p-2">
          <div className="flex items-center gap-2 px-1 py-1.5">
            <Avatar className="h-7 w-7 shrink-0 border border-border">
              <AvatarFallback className="bg-primary/10 text-xs text-primary">
                {(username || 'A').slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{username}</p>
              <p className="text-[10px] text-muted-foreground">{t('admin.admin')}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
            onClick={() => router.push('/workflows/editor')}
          >
            <ArrowLeft className="mr-1 h-3.5 w-3.5" />
            {t('admin.backToWorkspace')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground hover:text-destructive"
            onClick={handleLogout}
          >
            <LogOut className="mr-1 h-3.5 w-3.5" />
            {t('chat.logout')}
          </Button>
        </div>
      </aside>

      {/* 内容区 */}
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
