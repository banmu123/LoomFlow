/**
 * SkillsPage — Desktop 技能页面
 * 结构与 Web 端 /skills 一致，第一阶段显示 Coming Soon
 */

import { Sparkles } from 'lucide-react';
import { useT } from '@/lib/i18n';

export default function SkillsPage() {
  const t = useT();
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">{t('sidebar.skills')}</h1>
            <p className="text-sm text-muted-foreground">{t('skills.subtitle')}</p>
          </div>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center text-muted-foreground">
          <Sparkles className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
          <p className="text-sm font-medium">{t('common.comingSoonTitle')}</p>
          <p className="mt-1 text-xs text-muted-foreground/60">{t('common.comingSoonDesc')}</p>
        </div>
      </div>
    </div>
  );
}
