'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

/**
 * 主题切换按钮（日间 / 夜间 / 跟随系统）
 * - 点击在 light ↔ dark ↔ system 间循环
 * - compact=true 时只显示图标（用在侧边栏底部）
 */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const t = useT();
  // 避免 hydration mismatch：客户端挂载后才渲染（next-themes 也只在客户端解析主题）
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="h-7 w-7 shrink-0" />;

  const next = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const label =
    theme === 'dark' ? t('theme.dark') : theme === 'light' ? t('theme.light') : t('theme.system');

  return (
    <button
      onClick={() => setTheme(next)}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
        compact ? 'w-7 justify-center' : 'px-2 py-1',
      )}
      title={label}
      aria-label={label}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!compact && <span className="text-xs">{label}</span>}
    </button>
  );
}
