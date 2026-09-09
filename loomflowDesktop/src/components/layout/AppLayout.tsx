/**
 * AppLayout — Desktop 主布局
 *
 * Sidebar + Main Content
 */

import { NavLink, Outlet } from 'react-router-dom';
import { GitBranch, Settings, Play } from 'lucide-react';

const navItems = [
  { to: '/', icon: GitBranch, label: 'Workflows' },
  { to: '/runs', icon: Play, label: 'Runs' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export function AppLayout() {
  return (
    <div className="flex h-screen bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col border-r border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500 text-white font-bold text-sm">
            L
          </div>
          <div>
            <div className="text-sm font-semibold">LoomFlow</div>
            <div className="text-[10px] text-neutral-400">Desktop</div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-neutral-200/70 dark:bg-neutral-800 text-foreground'
                    : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800/50 hover:text-foreground'
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-neutral-200 dark:border-neutral-800 px-4 py-3">
          <p className="text-[10px] text-neutral-400">LoomFlow Desktop v0.1.0</p>
          <p className="text-[10px] text-neutral-400">Local-first</p>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
