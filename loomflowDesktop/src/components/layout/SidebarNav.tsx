/**
 * SidebarNav — Desktop 侧边栏
 *
 * 结构与 Web 端 SidebarNav 保持一致：Logo / Chat / Workspace / Admin / 底部设置
 * 差异：无 auth、无 conversation history API（第一阶段）、无 logout
 */

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  History,
  Clock,
  Cpu,
  Users,
  BarChart3,
  FileClock,
  Activity,
  Workflow,
  KeyRound,
  Library,
  CloudCog,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Boxes,
  Search,
  Sparkles,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ScrollArea } from '@/components/ui/scroll-area';

interface NavItem {
  href: string;
  labelKey: string;
  icon: typeof Workflow;
}

const WORKFLOW_ITEMS: NavItem[] = [
  { href: '/skills', labelKey: 'sidebar.skills', icon: Sparkles },
  { href: '/workflows', labelKey: 'sidebar.workflows', icon: Workflow },
  { href: '/workflows/editor', labelKey: 'sidebar.editor', icon: LayoutDashboard },
  { href: '/workflows/history', labelKey: 'sidebar.history', icon: History },
  { href: '/knowledge', labelKey: 'sidebar.knowledge', icon: Library },
];

const ADMIN_ITEMS: NavItem[] = [
  { href: '/admin/models', labelKey: 'sidebar.models', icon: Cpu },
  { href: '/admin/search-providers', labelKey: 'sidebar.searchProviders', icon: Search },
  { href: '/admin/users', labelKey: 'sidebar.users', icon: Users },
  { href: '/admin/stats', labelKey: 'sidebar.stats', icon: BarChart3 },
  { href: '/admin/logs', labelKey: 'sidebar.logs', icon: FileClock },
  { href: '/admin/api-logs', labelKey: 'sidebar.apiLogs', icon: Activity },
  { href: '/admin/oss', labelKey: 'sidebar.oss', icon: CloudCog },
];

export function SidebarNav() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);

  const isActive = (href: string) =>
    pathname === href || (href !== '/' && href !== '/workflows' && pathname.startsWith(href + '/'));

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const active = isActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        title={collapsed ? t(item.labelKey) : undefined}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-all',
          collapsed && 'justify-center px-0',
          active
            ? 'bg-primary/10 font-medium text-primary shadow-sm'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {!collapsed && <span className="truncate">{t(item.labelKey)}</span>}
      </Link>
    );
  };

  const renderCollapsibleSection = (
    labelKey: string,
    icon: typeof Workflow,
    items: NavItem[],
    open: boolean,
    onToggle: () => void,
  ) => {
    if (collapsed) {
      return (
        <button
          onClick={() => setCollapsed(false)}
          className="flex w-full items-center justify-center rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={t(labelKey)}
        >
          {(() => {
            const Icon = icon;
            return <Icon className="h-4 w-4" />;
          })()}
        </button>
      );
    }
    return (
      <>
        <button
          onClick={onToggle}
          className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <span className="flex items-center gap-2">
            {(() => {
              const Icon = icon;
              return <Icon className="h-4 w-4" />;
            })()}
            <span className="truncate">{t(labelKey)}</span>
          </span>
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        {open && <div className="space-y-0.5 pb-1 pl-2">{items.map(renderItem)}</div>}
      </>
    );
  };

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-border bg-sidebar transition-all',
        collapsed ? 'w-[52px]' : 'w-[210px]',
      )}
    >
      {/* 顶部：Logo + 折叠 */}
      <div className="shrink-0">
        <div className={cn('flex items-center border-b border-border py-3', collapsed ? 'justify-center' : 'justify-between px-3')}>
          <Link href="/" className="flex items-center gap-2" title="LoomFlow">
            <img src="/screenshots/logo.png" alt="LoomFlow" className="h-7 w-7 rounded-md object-contain shadow-md shadow-[#b77945]/25" />
            {!collapsed && <span className="text-brand-gradient truncate text-sm font-bold">LoomFlow</span>}
          </Link>
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={collapsed ? t('sidebar.expandSidebar') : t('sidebar.collapseSidebar')}
          >
            {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* Chat 入口 */}
        <div className="border-b border-border p-2">
          <Link
            href="/chat"
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium transition-all',
              pathname === '/chat' || pathname.startsWith('/chat/')
                ? 'bg-primary/10 text-primary'
                : 'text-foreground hover:bg-muted',
            )}
          >
            <MessageSquare className="h-4 w-4 shrink-0" />
            <span className="truncate">{t('sidebar.chat')}</span>
          </Link>
        </div>
      </div>

      {/* 中间可滚动：导航菜单 */}
      <ScrollArea className="flex-1 overflow-hidden">
        <nav className="flex flex-col gap-0.5 p-2">
          <div className="pt-1">
            {renderCollapsibleSection('sidebar.workspace', Workflow, WORKFLOW_ITEMS, workflowOpen, () => setWorkflowOpen((v) => !v))}
          </div>
          <div className="pt-1">
            {renderCollapsibleSection('sidebar.management', Cpu, ADMIN_ITEMS, adminOpen, () => setAdminOpen((v) => !v))}
          </div>
        </nav>
      </ScrollArea>

      {/* 底部：Desktop 标识 + 主题切换 + 设置 */}
      <div className={cn('shrink-0 space-y-1.5 border-t border-border p-2', collapsed && 'flex flex-col items-center')}>
        <div className={cn('flex items-center gap-2 py-1.5', collapsed ? 'px-0' : 'px-1')}>
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-primary/10">
            <span className="text-xs font-medium text-primary">D</span>
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">Desktop</p>
              <p className="text-[10px] text-muted-foreground">Local Mode</p>
            </div>
          )}
        </div>
        <div className={cn('flex items-center px-1', collapsed ? 'justify-center' : 'justify-between')}>
          <ThemeToggle compact />
          <Link
            href="/settings"
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Settings"
          >
            <Settings className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </aside>
  );
}
