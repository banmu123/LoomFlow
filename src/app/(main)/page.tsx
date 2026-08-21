'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowRight } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { AbilityRadar } from '@/components/AbilityRadar';
import { DailyCheckin } from '@/components/DailyCheckin';
import { AssessmentPanel } from '@/components/AssessmentPanel';
import { DIMENSIONS, DIMENSION_META, emptyScores } from '@/lib/growth/ability-types';
import type { AbilityScores } from '@/lib/growth/ability-types';
import { determineRole } from '@/lib/growth/ability-roles';

export default function HomePage() {
  const t = useT();
  const router = useRouter();
  const [scores, setScores] = useState<AbilityScores | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAssessment, setShowAssessment] = useState(false);
  const [role, setRole] = useState<{ id: string; labelKey: string; icon: string } | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);

  const loadScores = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/growth/abilities');
      const data = await res.json();
      if (data.profile?.scores) {
        setScores(data.profile.scores);
        setRole({
          id: data.profile.role,
          labelKey: `life.role${capitalize(data.profile.role)}`,
          icon: getRoleIcon(data.profile.role),
        });
        setShowAssessment(false);
      } else {
        setShowAssessment(true);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadScores(); }, [loadScores]);

  const handleAssessmentComplete = (newScores: AbilityScores, analysis: string) => {
    setScores(newScores);
    const r = determineRole(newScores);
    setRole({ id: r.id, labelKey: r.labelKey, icon: r.icon });
    setShowAssessment(false);
    if (analysis) {
      setAnalysis(analysis);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (showAssessment) {
    return (
      <AssessmentPanel
        onComplete={handleAssessmentComplete}
        onSkip={() => setShowAssessment(false)}
      />
    );
  }

  const currentRole = role || { id: 'explorer', labelKey: 'life.roleExplorer', icon: '🔍' };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{t('life.homeTitle')}</h1>
            <p className="text-sm text-muted-foreground">{t('life.homeSubtitle')}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => router.push('/chat')}>
            {t('life.goToChat')}
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <span className="text-2xl">{currentRole.icon}</span>
            <div>
              <p className="text-sm text-muted-foreground">{t('life.yourRole')}</p>
              <p className="text-lg font-semibold">{t(currentRole.labelKey)}</p>
            </div>
          </div>
          {scores && <AbilityRadar scores={scores} size="mini" onDimensionClick={() => router.push('/ability')} />}
          {scores && (
            <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {DIMENSIONS.map((dim) => {
                const meta = DIMENSION_META[dim];
                return (
                  <div key={dim} className="text-center">
                    <p className="text-lg">{meta.icon}</p>
                    <p className="text-xs text-muted-foreground">{t(meta.labelKey)}</p>
                    <p className="text-sm font-semibold">{scores[dim]}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <p className="mb-2 text-sm font-medium text-muted-foreground">{t('life.dailyCheckin')}</p>
          <DailyCheckin onComplete={loadScores} />
        </div>

        {/* AI 分析结果 */}
        {analysis && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
            <p className="mb-1 text-sm font-medium text-primary">{t('life.aiAnalysis')}</p>
            <p className="text-sm text-foreground">{analysis}</p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <RecommendCard
            icon="📊"
            title={t('life.viewFullPanel')}
            desc={t('life.viewFullPanelDesc')}
            onClick={() => router.push('/ability')}
          />
          <RecommendCard
            icon="💬"
            title={t('life.goToChat')}
            desc={t('life.goToChatDesc')}
            onClick={() => router.push('/chat')}
          />
        </div>
      </div>
    </div>
  );
}

function RecommendCard({ icon, title, desc, onClick }: { icon: string; title: string; desc: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-start gap-2 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40"
    >
      <span className="text-xl">{icon}</span>
      <p className="text-sm font-medium">{title}</p>
      <p className="line-clamp-2 text-xs text-muted-foreground">{desc}</p>
    </button>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function getRoleIcon(roleId: string): string {
  const icons: Record<string, string> = {
    thinker: '🧠', creator: '🎨', executor: '⚡',
    connector: '🤝', learner: '📚', resilient: '💪', allrounder: '🌟',
  };
  return icons[roleId] ?? '🔍';
}
