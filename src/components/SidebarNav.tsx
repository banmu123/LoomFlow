'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  GitBranch,
  LayoutDashboard,
  History,
  Clock,
  Cpu,
  Users,
  BarChart3,
  FileClock,
  Activity,
  LogOut,
  Workflow,
  KeyRound,
  Library,
  CloudCog,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { LocaleSwitcher } from './LocaleSwitcher';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

interface NavItem {
  href: string;
  labelKey: string;
  icon: typeof GitBranch;
}

// 左侧菜单栏：工作区 + 管理
const NAV_ITEMS: NavItem[] = [
  { href: '/workflows', labelKey: 'sidebar.workflows', icon: Workflow },
  { href: '/workflows/editor', labelKey: 'sidebar.editor', icon: LayoutDashboard },
  { href: '/workflows/history', labelKey: 'sidebar.history', icon: History },
  { href: '/workflows/schedules', labelKey: 'sidebar.schedules', icon: Clock },
  { href: '/workflows/api-keys', labelKey: 'sidebar.apiKeys', icon: KeyRound },
  { href: '/knowledge', labelKey: 'sidebar.knowledge', icon: Library },
];

const ADMIN_ITEMS: NavItem[] = [
  { href: '/admin/models', labelKey: 'sidebar.models', icon: Cpu },
  { href: '/admin/users', labelKey: 'sidebar.users', icon: Users },
  { href: '/admin/stats', labelKey: 'sidebar.stats', icon: BarChart3 },
  { href: '/admin/logs', labelKey: 'sidebar.logs', icon: FileClock },
  { href: '/admin/api-logs', labelKey: 'sidebar.apiLogs', icon: Activity },
  { href: '/admin/oss', labelKey: 'sidebar.oss', icon: CloudCog },
];

export function SidebarNav() {
  const router = useRouter();
  const pathname = usePathname();
  const t = useT();
  const [isAdmin, setIsAdmin] = useState(false);
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        if (data?.authenticated) {
          setUsername(data.user?.username || '');
          setRole(data.user?.role || '');
          if (data.user?.role === 'admin') setIsAdmin(true);
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    router.push('/login');
  };

  const isActive = (href: string) =>
    pathname === href || (href !== '/workflows' && pathname.startsWith(href + '/'));

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const active = isActive(item.href);
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
  };

  return (
    <aside className="flex w-[190px] shrink-0 flex-col border-r border-border bg-card">
      {/* Logo */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
          <GitBranch className="h-4 w-4 text-primary" />
        </div>
        <span className="truncate text-sm font-semibold">{t('app.name')}</span>
      </div>

      {/* 导航 */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        <p className="px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase text-muted-foreground/70">
          {t('sidebar.workspace')}
        </p>
        {NAV_ITEMS.map(renderItem)}

        {isAdmin && (
          <>
            <p className="px-2.5 pb-1 pt-3 text-[10px] font-medium uppercase text-muted-foreground/70">
              {t('sidebar.management')}
            </p>
            {ADMIN_ITEMS.map(renderItem)}
          </>
        )}
      </nav>

      {/* 底部：用户信息 + 语言 + 退出 */}
      <div className="space-y-1.5 border-t border-border p-2">
        <div className="flex items-center gap-2 px-1 py-1.5">
          <Avatar className="h-7 w-7 shrink-0 border border-border">
            <AvatarFallback className="bg-primary/10 text-xs text-primary">
              {(username || 'U').slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">{username || '...'}</p>
            <p className="text-[10px] text-muted-foreground">
              {role === 'admin' ? t('admin.admin') : t('admin.user')}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between px-1">
          <LocaleSwitcher compact />
          <button
            onClick={handleLogout}
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-destructive"
            title={t('chat.logout')}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
