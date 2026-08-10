'use client';

import { Languages } from 'lucide-react';
import { useLocale } from '@/lib/i18n';

// 语言切换（中/英）
export function LocaleSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale } = useLocale();

  return (
    <button
      onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
      className={
        compact
          ? 'flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground'
          : 'inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
      }
      title={locale === 'zh' ? 'Switch to English' : '切换到中文'}
    >
      <Languages className="h-4 w-4" />
      {!compact && <span>{locale === 'zh' ? 'EN' : '中文'}</span>}
    </button>
  );
}
