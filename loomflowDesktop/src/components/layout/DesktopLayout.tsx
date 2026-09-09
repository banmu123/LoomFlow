/**
 * DesktopLayout — 与 Web 端 MainLayoutClient 结构一致：Sidebar + Main
 */

import { Outlet } from 'react-router-dom';
import { SidebarNav } from './SidebarNav';

export function DesktopLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <SidebarNav />
      <main className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
