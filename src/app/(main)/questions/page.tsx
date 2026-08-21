'use client';

import { PenLine } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { QuestionPanel } from '@/components/QuestionPanel';

export default function QuestionsPage() {
  const t = useT();

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl space-y-6 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <PenLine className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">{t('life.questionsTitle')}</h1>
            <p className="text-sm text-muted-foreground">{t('life.questionsDesc')}</p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <QuestionPanel />
        </div>
      </div>
    </div>
  );
}
