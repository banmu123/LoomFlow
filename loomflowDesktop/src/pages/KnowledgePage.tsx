/**
 * KnowledgePage — Desktop 知识库页面
 * 结构与 Web 端 /knowledge 一致，第一阶段显示 Coming Soon
 */

import { Library } from 'lucide-react';
import { useT } from '@/lib/i18n';

export default function KnowledgePage() {
  const t = useT();
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Library className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">{t('sidebar.knowledge')}</h1>
            <p className="text-sm text-muted-foreground">Manage your knowledge bases</p>
          </div>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center text-muted-foreground">
          <Library className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
          <p className="text-sm font-medium">Coming Soon</p>
          <p className="mt-1 text-xs text-muted-foreground/60">Knowledge base will be available in a future update</p>
        </div>
      </div>
    </div>
  );
}
