/**
 * SettingsPage — Desktop 设置页
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { useRepository } from '../app/repositories';

export default function SettingsPage() {
  const navigate = useNavigate();
  const repo = useRepository();
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState('system');

  useEffect(() => {
    (async () => {
      try { const v = await repo.getSetting('theme'); if (v) setTheme(v); } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, [repo]);

  const saveSetting = useCallback(async (key: string, value: string) => {
    try { await repo.setSetting(key, value); toast.success(t('common.success')); } catch { toast.error(t('common.error')); }
  }, [repo, t]);

  if (loading) return <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Settings className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">{t('sidebar.settings') || 'Settings'}</h1>
            <p className="text-sm text-muted-foreground">Desktop preferences</p>
          </div>
        </div>
      </div>
      <div className="flex-1 p-6 max-w-2xl space-y-8">
        <section>
          <h2 className="text-sm font-medium mb-3">{t('theme.title') || 'Appearance'}</h2>
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">{t('theme.title') || 'Theme'}</label>
            <select
              value={theme}
              onChange={(e) => {
                setTheme(e.target.value);
                saveSetting('theme', e.target.value);
                const root = document.documentElement;
                if (e.target.value === 'dark') root.classList.add('dark');
                else if (e.target.value === 'light') root.classList.remove('dark');
                else root.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches);
              }}
              className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
            >
              <option value="system">{t('theme.system') || 'System'}</option>
              <option value="light">{t('theme.light') || 'Light'}</option>
              <option value="dark">{t('theme.dark') || 'Dark'}</option>
            </select>
          </div>
        </section>
        <section>
          <h2 className="text-sm font-medium mb-3">About</h2>
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm font-medium">LoomFlow Desktop</p>
            <p className="text-xs text-muted-foreground mt-1">v0.1.0 — Local-first AI Workflow Development Environment</p>
            <p className="text-xs text-muted-foreground/60 mt-2">Data stored locally in SQLite. No cloud connection required.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
