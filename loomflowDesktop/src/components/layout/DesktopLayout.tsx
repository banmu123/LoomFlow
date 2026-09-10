/**
 * DesktopLayout — 与 Web 端 MainLayoutClient 结构一致：Sidebar + Main
 *
 * 另外承载全局快捷键：
 * - Cmd/Ctrl + N → 新建工作流（进入空白画布），与 docs/desktop.md 的声明一致
 */

import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { SidebarNav } from './SidebarNav';

export function DesktopLayout() {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        navigate('/workflows/editor');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <SidebarNav />
      <main className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
