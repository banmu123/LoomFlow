/**
 * SettingsPage — Desktop 设置页
 *
 * - 主题：交由 next-themes 管理（与侧边栏 ThemeToggle 同一数据源），
 *   避免此前直接操作 documentElement 造成的主题状态不一致；
 *   同时写回 settings 表，保持本地设置记录完整。
 * - 语言：复用 Web 端 i18n（useLocale），并写回 settings 表。
 * - 关于：通过 Tauri 命令 get_app_info 读取真实版本号（浏览器预览时回退）。
 */

import { useEffect, useState, useCallback } from 'react';
import { useTheme } from 'next-themes';
import { Settings, Loader2, Info } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { useT, useLocale, translate, type Locale } from '@/lib/i18n';
import { useRepository } from '../app/repositories';

interface AppInfo {
  name: string;
  version: string;
}

/** 打包版本（Tauri 运行时优先从 Rust 侧读取；浏览器预览时使用此回退） */
const FALLBACK_APP_INFO: AppInfo = { name: 'LoomFlow Desktop', version: '0.1.0' };

const LOCALES: { value: Locale; label: string }[] = [
  { value: 'zh', label: '简体中文' },
  { value: 'en', label: 'English' },
];

export default function SettingsPage() {
  const repo = useRepository();
  const t = useT();
  const { locale, setLocale } = useLocale();
  const { theme, setTheme } = useTheme();

  const [appInfo, setAppInfo] = useState<AppInfo>(FALLBACK_APP_INFO);
  // next-themes 只在客户端解析主题，挂载前不渲染真实值，避免闪烁
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // 读取真实应用信息（非 Tauri 环境会抛错，直接使用回退值）
  useEffect(() => {
    let cancelled = false;
    invoke<AppInfo>('get_app_info')
      .then((info) => {
        if (!cancelled && info?.version) {
          setAppInfo({ name: info.name ?? FALLBACK_APP_INFO.name, version: info.version });
        }
      })
      .catch(() => { /* 浏览器预览 / 命令不可用时忽略 */ });
    return () => { cancelled = true; };
  }, []);

  const persist = useCallback(
    async (key: string, value: string) => {
      try { await repo.setSetting(key, value); } catch { /* 设置表写入失败不影响当前会话 */ }
    },
    [repo],
  );

  const handleThemeChange = useCallback((value: string) => {
    setTheme(value);
    void persist('theme', value);
    // 文案跟随当前语言；主题名走 i18n，避免出现英文界面夹中文枚举值
    toast.success(t('settings.themeSwitched', { theme: t(`theme.${value}`) }));
  }, [setTheme, persist, t]);

  const handleLocaleChange = useCallback((value: Locale) => {
    setLocale(value);
    void persist('locale', value);
    // 用目标语言翻译：setLocale 后组件还没重渲染，直接用 t() 会得到旧语言文案
    const label = LOCALES.find((l) => l.value === value)?.label ?? value;
    toast.success(translate(value, 'settings.languageSwitched', { language: label }));
  }, [setLocale, persist]);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Settings className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">{t('settings.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('settings.subtitle')}</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl flex-1 space-y-8 p-6">
        <section>
          <h2 className="mb-3 text-sm font-medium">{t('theme.title')}</h2>
          <div className="flex items-center justify-between rounded-lg border border-border p-4">
            <label htmlFor="theme-select" className="text-sm text-muted-foreground">{t('theme.title')}</label>
            <select
              id="theme-select"
              value={mounted ? theme ?? 'system' : 'system'}
              onChange={(e) => handleThemeChange(e.target.value)}
              className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
            >
              <option value="system">{t('theme.system')}</option>
              <option value="light">{t('theme.light')}</option>
              <option value="dark">{t('theme.dark')}</option>
            </select>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium">{t('settings.language')}</h2>
          <div className="flex items-center justify-between rounded-lg border border-border p-4">
            <label htmlFor="locale-select" className="text-sm text-muted-foreground">{t('settings.language')}</label>
            <select
              id="locale-select"
              value={locale}
              onChange={(e) => handleLocaleChange(e.target.value as Locale)}
              className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
            >
              {LOCALES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium">{t('settings.about')}</h2>
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Info className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">{appInfo.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  v{appInfo.version} — {t('settings.tagline')}
                </p>
                <p className="mt-2 text-xs text-muted-foreground/60">
                  {t('settings.storageNote')}
                </p>
              </div>
            </div>
          </div>
        </section>

        {!mounted && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('common.loading')}
          </div>
        )}
      </div>
    </div>
  );
}
