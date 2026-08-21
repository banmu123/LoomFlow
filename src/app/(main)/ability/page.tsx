'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw, PenLine, Target } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AbilityRadar } from '@/components/AbilityRadar';
import { DIMENSIONS, DIMENSION_META, emptyScores } from '@/lib/growth/ability-types';
import type { AbilityScores, AbilityDimension } from '@/lib/growth/ability-types';
import { determineRole } from '@/lib/growth/ability-roles';

export default function AbilityPage() {
  const t = useT();
  const router = useRouter();
  const [scores, setScores] = useState<AbilityScores>(emptyScores());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [role, setRole] = useState(determineRole(emptyScores()));

  const loadScores = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/growth/abilities');
      const data = await res.json();
      if (data.profile?.scores) {
        setScores(data.profile.scores);
        setRole(determineRole(data.profile.scores));
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadScores(); }, [loadScores]);

  const refreshAnalysis = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/growth/abilities', { method: 'POST' });
      const data = await res.json();
      if (data.scores) {
        setScores(data.scores);
        setRole(determineRole(data.scores));
        toast.success(t('life.analysisDone'));
      }
    } catch {
      toast.error(t('life.analysisFailed'));
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Target className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">{t('life.panelTitle')}</h1>
              <p className="text-sm text-muted-foreground">{t('life.panelSubtitle')}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={refreshAnalysis} disabled={refreshing}>
            <RefreshCw className={cn('mr-1 h-3.5 w-3.5', refreshing && 'animate-spin')} />
            {t('life.refreshAnalysis')}
          </Button>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-6">
            <AbilityRadar scores={scores} size="full" onDimensionClick={() => {}} />
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{role.icon}</span>
                <div>
                  <p className="text-sm text-muted-foreground">{t('life.yourRole')}</p>
                  <p className="text-lg font-semibold">{t(role.labelKey)}</p>
                </div>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{t(role.descriptionKey)}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {role.strengths.map((dim) => (
                  <Badge key={dim} variant="secondary" className="text-xs">
                    {DIMENSION_META[dim].icon} {t(DIMENSION_META[dim].labelKey)} {scores[dim]}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              {DIMENSIONS.map((dim) => {
                const meta = DIMENSION_META[dim];
                const score = scores[dim];
                return (
                  <div key={dim} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
                    <span className="text-lg">{meta.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{t(meta.labelKey)}</span>
                        <span className="text-sm font-semibold">{score}</span>
                      </div>
                      <div className="mt-1 h-2 w-full rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full transition-all"
                          style={{
                            width: `${score}%`,
                            backgroundColor: meta.color,
                          }}
                        />
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      onClick={() => router.push('/questions')}
                    >
                      <PenLine className="mr-1 h-3 w-3" />
                      {t('life.goPractice')}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
