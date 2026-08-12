'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FolderKanban,
  GitBranch,
  Factory,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { UserMenu } from './UserMenu';

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

const NAV_ITEMS: NavItem[] = [
  { label: 'Command 总控', href: '/command', icon: LayoutDashboard },
  { label: 'Project 项目事实', href: '/project', icon: FolderKanban },
  { label: 'Workflows 工作流', href: '/workflows', icon: GitBranch },
  { label: 'Production 生产', href: '/production', icon: Factory },
  { label: 'Governance 治理', href: '/governance', icon: ShieldCheck },
];

export function SidebarNav({
  panelOpen,
  onTogglePanel,
}: {
  panelOpen: boolean;
  onTogglePanel: () => void;
}) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    pathname === href || pathname?.startsWith(href + '/');

  return (
    <aside className="flex w-[200px] shrink-0 flex-col border-r border-border bg-card">
      {/* LOGO 区域 */}
      <div className="flex h-[60px] items-center border-b border-border px-5">
        <span className="text-lg font-extrabold tracking-wide text-primary whitespace-nowrap">
          LoomFlow
        </span>
      </div>

      {/* 导航菜单区域 */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-3">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors',
                active
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* 底部操作区域 */}
      <div className="space-y-2 border-t border-border p-3">
        {/* AI 对话按钮 */}
        <button
          onClick={onTogglePanel}
          className={cn(
            'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors',
            panelOpen
              ? 'bg-primary/10 font-medium text-primary'
              : 'text-muted-foreground hover:bg-primary/10 hover:text-primary',
          )}
        >
          <Sparkles className="h-4 w-4 shrink-0" />
          AI 对话
        </button>

        {/* 用户菜单 */}
        <UserMenu />
      </div>
    </aside>
  );
}
