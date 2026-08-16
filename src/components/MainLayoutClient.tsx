'use client';

import { SidebarNav } from './SidebarNav';
import { SessionGuard } from './SessionGuard';
import { ErrorBoundary } from './ErrorBoundary';

// 布局：左侧栏（菜单 + 管理 + 对话历史，可折叠）| 主区域（当前路由页面）
// - / 为对话页（ChatPanel 全屏）
// - 菜单项切换显示对应页面（工作流/画布/知识库/管理…）
export function MainLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <SidebarNav />
      <main className="min-w-0 flex-1 overflow-hidden">
        <SessionGuard>
          <ErrorBoundary>{children}</ErrorBoundary>
        </SessionGuard>
      </main>
    </div>
  );
}
