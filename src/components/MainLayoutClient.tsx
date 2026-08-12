'use client';

import { SidebarNav } from './SidebarNav';
import { ChatPanel } from './ChatPanel';
import { SessionGuard } from './SessionGuard';
import { ErrorBoundary } from './ErrorBoundary';

export function MainLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <SidebarNav />
      <ChatPanel />
      <main className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
        <SessionGuard>
          <ErrorBoundary>{children}</ErrorBoundary>
        </SessionGuard>
      </main>
    </div>
  );
}
