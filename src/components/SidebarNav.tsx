'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
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
  FlaskConical,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Trash2,
  Boxes,
  Search,
} from 'lucide-react';
import { cn, truncateTitle } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { LocaleSwitcher } from './LocaleSwitcher';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ConfirmDialog } from '@/components/ConfirmDialog';

interface NavItem {
  href: string;
  labelKey: string;
  icon: typeof Workflow;
}

interface ConversationItem {
  id: string;
  title: string;
}

const WORKFLOW_ITEMS: NavItem[] = [
  { href: '/workflows', labelKey: 'sidebar.workflows', icon: Workflow },
  { href: '/workflows/editor', labelKey: 'sidebar.editor', icon: LayoutDashboard },
  { href: '/workflows/history', labelKey: 'sidebar.history', icon: History },
  { href: '/workflows/schedules', labelKey: 'sidebar.schedules', icon: Clock },
  { href: '/workflows/api-keys', labelKey: 'sidebar.apiKeys', icon: KeyRound },
  { href: '/workflows/custom-nodes', labelKey: 'sidebar.customNodes', icon: Boxes },
  { href: '/knowledge', labelKey: 'sidebar.knowledge', icon: Library },
  { href: '/lab', labelKey: 'sidebar.lab', icon: FlaskConical },
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
  const router = useRouter();
  const pathname = usePathname();
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('');
  const [adminOpen, setAdminOpen] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<ConversationItem | null>(null);
  const activeConvId = pathname.startsWith('/chat/') ? pathname.slice('/chat/'.length) : '';

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

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations');
      const data = await res.json();
      if (Array.isArray(data)) {
        setConversations(
          data.map((c: { id: string; title: string }) => ({
            id: c.id,
            title: c.title || '未命名对话',
          })),
        );
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    const handler = () => loadConversations();
    window.addEventListener('conversations-updated', handler);
    return () => window.removeEventListener('conversations-updated', handler);
  }, [loadConversations]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    router.push('/login');
  };

  const handleDeleteConversation = async (conv: ConversationItem) => {
    setDeleteTarget(null);
    try {
      await fetch(`/api/conversations/${conv.id}`, { method: 'DELETE' });
      if (pathname === `/chat/${conv.id}`) router.push('/chat');
    } catch {
      // ignore
    } finally {
      loadConversations();
    }
  };

  const isActive = (href: string) =>
    pathname === href || (href !== '/' && href !== '/workflows' && pathname.startsWith(href + '/'));

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const active = isActive(item.href);
    return (
      <button
        key={item.href}
        onClick={() => router.push(item.href)}
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
      </button>
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

  const openConversation = (id: string) => {
    if (pathname !== `/chat/${id}`) router.push(`/chat/${id}`);
  };

  const newConversation = () => {
    if (pathname !== '/chat') router.push('/chat');
  };

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-border bg-sidebar transition-all',
        collapsed ? 'w-[52px]' : 'w-[210px]',
      )}
    >
      {/* 顶部固定：Logo + 新聊天 */}
      <div className="shrink-0">
        <div className={cn('flex items-center border-b border-border py-3', collapsed ? 'justify-center' : 'justify-between px-3')}>
          <button onClick={() => router.push('/chat')} className="flex items-center gap-2" title={t('app.name')}>
            <img src="/screenshots/logo.png" alt="LoomFlow" className="h-7 w-7 rounded-md object-contain shadow-md shadow-[#b77945]/25" />
            {!collapsed && <span className="text-brand-gradient truncate text-sm font-bold">{t('app.name')}</span>}
          </button>
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
          </button>
        </div>

        <div className="border-b border-border p-2">
          <button
            onClick={newConversation}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium transition-all',
              pathname === '/chat'
                ? 'bg-primary/10 text-primary'
                : 'text-foreground hover:bg-muted',
            )}
          >
            <MessageSquare className="h-4 w-4 shrink-0" />
            <span className="truncate">{t('sidebar.chat')}</span>
          </button>
        </div>
      </div>

      {/* 中间可滚动：导航菜单 + 对话历史 */}
      <ScrollArea className="flex-1 overflow-hidden">
        <nav className="flex flex-col gap-0.5 p-2">
          {/* 工作区（可折叠） */}
          <div className="pt-1">
            {renderCollapsibleSection('sidebar.workspace', Workflow, WORKFLOW_ITEMS, workflowOpen, () => setWorkflowOpen((v) => !v))}
          </div>

          {/* 管理（可折叠） */}
          {isAdmin && (
            <div className="pt-1">
              {renderCollapsibleSection('sidebar.management', Cpu, ADMIN_ITEMS, adminOpen, () => setAdminOpen((v) => !v))}
            </div>
          )}

          {/* 对话历史 */}
          {!collapsed && (
            <div className="border-t border-border/60 pt-3">
              <div className="flex items-center justify-between px-2.5 pb-1">
                <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase text-muted-foreground/70">
                  <MessagesSquare className="h-3 w-3" />
                  {t('chat.history')}
                </span>
              </div>
              <div className="space-y-0.5">
                {conversations.length === 0 && (
                  <p className="px-2.5 py-1 text-xs text-muted-foreground/60">
                    {t('chat.noConversations')}
                  </p>
                )}
                {conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={cn(
                      'group flex w-full items-center rounded-md px-2.5 py-1.5 text-sm transition-colors',
                      conv.id === activeConvId
                        ? 'bg-primary/10 font-medium text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <button
                      onClick={() => openConversation(conv.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
                      <span className="truncate">{truncateTitle(conv.title)}</span>
                    </button>
                    <button
                      onClick={() => setDeleteTarget(conv)}
                      className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      title="删除对话"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </nav>
      </ScrollArea>

      {/* 底部固定：用户信息 + 语言 + 退出 */}
      <div className={cn('shrink-0 space-y-1.5 border-t border-border p-2', collapsed && 'flex flex-col items-center')}>
        <div className={cn('flex items-center gap-2 py-1.5', collapsed ? 'px-0' : 'px-1')} title={collapsed ? username || '' : undefined}>
          <Avatar className="h-7 w-7 shrink-0 border border-border">
            <AvatarFallback className="bg-primary/10 text-xs text-primary">
              {(username || 'U').slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{username || '...'}</p>
              <p className="text-[10px] text-muted-foreground">
                {role === 'admin' ? t('admin.admin') : t('admin.user')}
              </p>
            </div>
          )}
        </div>
        <div className={cn('flex items-center px-1', collapsed ? 'justify-center' : 'justify-between')}>
          {!collapsed && <LocaleSwitcher compact />}
          <button
            onClick={handleLogout}
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-destructive"
            title={t('chat.logout')}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 删除对话确认 */}
      <ConfirmDialog
        open={!!deleteTarget}
        destructive
        title={deleteTarget ? t('chat.deleteConversationConfirm', { title: deleteTarget.title }) : ''}
        onConfirm={() => {
          if (deleteTarget) handleDeleteConversation(deleteTarget);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </aside>
  );
}
