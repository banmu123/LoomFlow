'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { zh } from '@/messages/zh';
import { en } from '@/messages/en';

export type Locale = 'zh' | 'en';
export type Messages = typeof zh;

const STORAGE_KEY = 'forgeflow_locale';

const MESSAGES: Record<Locale, Messages> = { zh, en };

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

export const I18nContext = createContext<I18nContextValue>({
  locale: 'zh',
  setLocale: () => {},
  t: (key) => key,
});

// 嵌套 key 解析：t('common.save') → messages.common.save
function resolveKey(messages: Messages, key: string): string | undefined {
  const parts = key.split('.');
  let node: unknown = messages;
  for (const part of parts) {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === 'string' ? node : undefined;
}

// 替换 {param} 占位符
function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    name in params ? String(params[name]) : match,
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('zh');

  // 初始化：优先 localStorage，其次浏览器语言
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'zh' || saved === 'en') {
      setLocaleState(saved);
      return;
    }
    const browserLang = navigator.language?.toLowerCase() || '';
    if (browserLang.startsWith('en')) {
      setLocaleState('en');
    }
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
    // 更新 html lang
    document.documentElement.lang = l;
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const resolved = resolveKey(MESSAGES[locale], key);
      if (resolved !== undefined) return interpolate(resolved, params);
      // 回退中文
      const zhResolved = resolveKey(zh, key);
      return zhResolved !== undefined ? interpolate(zhResolved, params) : key;
    },
    [locale],
  );

  const contextValue = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return (
    <I18nContext.Provider value={contextValue}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

// 简写：const { t } = useI18n()
export function useT() {
  const { t } = useContext(I18nContext);
  return t;
}

export function useLocale() {
  const { locale, setLocale } = useContext(I18nContext);
  return { locale, setLocale };
}
