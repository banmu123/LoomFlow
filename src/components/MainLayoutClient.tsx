'use client';

import { useState } from 'react';
import { SidebarNav } from './SidebarNav';
import { ChatPanel } from './ChatPanel';
import { SessionGuard } from './SessionGuard';
import { ErrorBoundary } from './ErrorBoundary';
import { MessageSquare } from 'lucide-react';

export function MainLayoutClient({ children }: { children: React.ReactNode }) {
  const [chatCollapsed, setChatCollapsed] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      <SidebarNav />
      {chatCollapsed ? (
        /* 收起后的窄条（点击展开） */
        <button
          onClick={() => setChatCollapsed(false)}
          className="flex w-9 shrink-0 flex-col items-center gap-2 border-r border-border bg-card py-3 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="展开 AI 对话"
        >
          <MessageSquare className="h-4 w-4" />
          <span className="text-[10px] [writing-mode:vertical-rl]">AI 对话</span>
        </button>
      ) : (
        <ChatPanel onCollapse={() => setChatCollapsed(true)} />
      )}
      <main className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
        <SessionGuard>
          <ErrorBoundary>{children}</ErrorBoundary>
        </SessionGuard>
      </main>
    </div>
  );
}
