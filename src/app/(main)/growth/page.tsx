'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Sparkles, Trash2, Pencil, Loader2, RefreshCw, ChevronDown, ChevronRight, Target, Route } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Goal, Journey, Capability } from '@/lib/growth/types';
import { CAPABILITY_STATUSES } from '@/lib/growth/types';

// ===== Growth System：Goal & Journey 基础管理 =====

const CAP_STATUS_STYLE: Record<string, string> = {
  locked: 'bg-muted text-muted-foreground',
  exploring: 'bg-blue-500/10 text-blue-600',
  developing: 'bg-amber-500/10 text-amber-600',
  mastered: 'bg-green-500/10 text-green-600',
};

interface GeneratedJourneyData {
  title: string;
  description: string;
  capabilities: Array<{ title: string; description: string; prerequisites: string[] }>;
}

export default function GrowthPage() {
  const t = useT();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [journeysByGoal, setJourneysByGoal] = useState<Record<string, Array<Journey & { capabilities: Capability[] }>>>({});
  const [expandedGoal, setExpandedGoal] = useState<string | null>(null);

  // 新建/编辑 Goal
  const [goalDialog, setGoalDialog] = useState<{ editing: Goal | null } | null>(null);
  const [goalForm, setGoalForm] = useState({ title: '', description: '' });
  const [saving, setSaving] = useState(false);

  // AI 生成 Goal
  const [aiGoalPrompt, setAiGoalPrompt] = useState('');
  const [aiGoalResult, setAiGoalResult] = useState<{ title: string; description: string } | null>(null);
  const [aiGoalLoading, setAiGoalLoading] = useState(false);

  // AI 生成 Journey
  const [aiJourneyLoading, setAiJourneyLoading] = useState<string | null>(null);
  const [aiJourneyResults, setAiJourneyResults] = useState<Record<string, GeneratedJourneyData>>({});
  const [pendingJourneyGoal, setPendingJourneyGoal] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'goal' | 'journey'; id: string; title: string } | null>(null);

  const loadGoals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/growth/goals');
      const data = await res.json();
      if (Array.isArray(data)) setGoals(data);
      else toast.error(data?.error || t('growth.loadFailed'));
    } catch {
      toast.error(t('growth.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadGoals();
  }, [loadGoals]);

  const loadJourneys = useCallback(async (goalId: string) => {
    try {
      const res = await fetch(`/api/growth/goals/${goalId}`);
      const data = await res.json();
      if (Array.isArray(data?.journeys)) {
        setJourneysByGoal((prev) => ({ ...prev, [goalId]: data.journeys }));
      }
    } catch {
      // ignore
    }
  }, []);

  const toggleGoal = (goalId: string) => {
    setExpandedGoal((prev) => {
      const next = prev === goalId ? null : goalId;
      if (next) loadJourneys(goalId);
      return next;
    });
  };

  // ===== Goal CRUD =====
  const saveGoal = async () => {
    if (!goalForm.title.trim()) {
      toast.error(t('growth.goalTitleRequired'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(goalDialog?.editing ? `/api/growth/goals/${goalDialog.editing.id}` : '/api/growth/goals', {
        method: goalDialog?.editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(goalForm),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(goalDialog?.editing ? t('growth.goalUpdated') : t('growth.goalCreated'));
        setGoalDialog(null);
        loadGoals();
      } else {
        toast.error(data?.error || t('growth.saveFailed'));
      }
    } catch {
      toast.error(t('growth.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const deleteGoal = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/growth/goals/${deleteTarget.id}`, { method: 'DELETE' });
      if (res.ok) toast.success(t('growth.goalDeleted'));
      else toast.error(t('growth.deleteFailed'));
      setDeleteTarget(null);
      loadGoals();
    } catch {
      toast.error(t('growth.deleteFailed'));
    }
  };

  // ===== AI 生成 Goal =====
  const runAiGoal = async () => {
    if (!aiGoalPrompt.trim() || aiGoalLoading) return;
    setAiGoalLoading(true);
    setAiGoalResult(null);
    try {
      const res = await fetch('/api/growth/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'goal', input: aiGoalPrompt }),
      });
      const data = await res.json();
      if (res.ok && data?.data) setAiGoalResult(data.data);
      else toast.error(data?.error || t('growth.aiFailed'));
    } catch {
      toast.error(t('growth.aiFailed'));
    } finally {
      setAiGoalLoading(false);
    }
  };

  const saveAiGoal = async () => {
    if (!aiGoalResult) return;
    setSaving(true);
    try {
      const res = await fetch('/api/growth/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiGoalResult),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(t('growth.goalCreated'));
        setAiGoalResult(null);
        setAiGoalPrompt('');
        loadGoals();
      } else {
        toast.error(data?.error || t('growth.saveFailed'));
      }
    } catch {
      toast.error(t('growth.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  // ===== AI 生成 Journey =====
  const runAiJourney = async (goalId: string) => {
    if (aiJourneyLoading) return;
    setAiJourneyLoading(goalId);
    try {
      const res = await fetch('/api/growth/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'journey', goalId }),
      });
      const data = await res.json();
      if (res.ok && data?.data) {
        setAiJourneyResults((prev) => ({ ...prev, [goalId]: data.data }));
        setPendingJourneyGoal(goalId);
      } else {
        toast.error(data?.error || t('growth.aiFailed'));
      }
    } catch {
      toast.error(t('growth.aiFailed'));
    } finally {
      setAiJourneyLoading(null);
    }
  };

  const saveAiJourney = async () => {
    if (!pendingJourneyGoal) return;
    const data = aiJourneyResults[pendingJourneyGoal];
    if (!data) return;
    setSaving(true);
    try {
      const res = await fetch('/api/growth/journeys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goalId: pendingJourneyGoal, ...data }),
      });
      const result = await res.json();
      if (res.ok) {
        toast.success(t('growth.journeyCreated'));
        setAiJourneyResults((prev) => {
          const next = { ...prev };
          delete next[pendingJourneyGoal];
          return next;
        });
        setPendingJourneyGoal(null);
        loadJourneys(pendingJourneyGoal);
      } else {
        toast.error(result?.error || t('growth.saveFailed'));
      }
    } catch {
      toast.error(t('growth.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const discardAiJourney = () => {
    if (!pendingJourneyGoal) return;
    setAiJourneyResults((prev) => {
      const next = { ...prev };
      delete next[pendingJourneyGoal];
      return next;
    });
    setPendingJourneyGoal(null);
  };

  // ===== Journey 操作 =====
  const deleteJourney = async () => {
    if (!deleteTarget || deleteTarget.kind !== 'journey') return;
    try {
      const res = await fetch(`/api/growth/journeys/${deleteTarget.id}`, { method: 'DELETE' });
      if (res.ok) toast.success(t('growth.journeyDeleted'));
      else toast.error(t('growth.deleteFailed'));
      setDeleteTarget(null);
      // 刷新当前展开的 goal
      const goalId = Object.keys(journeysByGoal).find((gid) =>
        journeysByGoal[gid]?.some((j) => j.id === deleteTarget.id),
      );
      if (goalId) loadJourneys(goalId);
    } catch {
      toast.error(t('growth.deleteFailed'));
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Target className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">{t('growth.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('growth.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadGoals} disabled={loading}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setGoalForm({ title: '', description: '' });
              setGoalDialog({ editing: null });
            }}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('growth.newGoal')}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-6">
        {loading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('common.loading')}
          </div>
        ) : goals.length === 0 ? (
          <div className="mx-auto max-w-md py-16 text-center">
            <Target className="mx-auto mb-3 h-10 w-10 text-primary/40" />
            <p className="text-sm text-muted-foreground">{t('growth.emptyGoals')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {goals.map((goal) => {
              const expanded = expandedGoal === goal.id;
              const journeys = journeysByGoal[goal.id] ?? [];
              const aiResult = aiJourneyResults[goal.id];
              const statusLabel = t(`growth.goalStatus${goal.status.charAt(0).toUpperCase()}${goal.status.slice(1)}`);
              return (
                <div key={goal.id} className="rounded-lg border border-border bg-card">
                  <div className="flex items-center gap-3 p-4">
                    <button
                      onClick={() => toggleGoal(goal.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      {expanded ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{goal.title}</p>
                        {goal.description && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {goal.description}
                          </p>
                        )}
                      </div>
                    </button>
                    <Badge variant="outline" className="shrink-0">
                      {statusLabel}
                    </Badge>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title={t('common.edit')}
                        onClick={() => {
                          setGoalForm({ title: goal.title, description: goal.description || '' });
                          setGoalDialog({ editing: goal });
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        title={t('common.delete')}
                        onClick={() => setDeleteTarget({ kind: 'goal', id: goal.id, title: goal.title })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Journeys（展开） */}
                  {expanded && (
                    <div className="space-y-2 border-t border-border/60 px-4 py-3">
                      <div className="flex items-center justify-between">
                        <p className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                          <Route className="h-3.5 w-3.5" />
                          {t('growth.journeyTitle')}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-xs"
                          onClick={() => runAiJourney(goal.id)}
                          disabled={aiJourneyLoading !== null}
                        >
                          {aiJourneyLoading === goal.id ? (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          ) : (
                            <Sparkles className="mr-1 h-3 w-3" />
                          )}
                          {t('growth.aiGenerateJourney')}
                        </Button>
                      </div>

                      {/* AI 生成预览（确认后保存） */}
                      {aiResult && (
                        <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                          <p className="font-medium text-sm">{aiResult.title}</p>
                          {aiResult.description && (
                            <p className="mt-1 text-xs text-muted-foreground">{aiResult.description}</p>
                          )}
                          <div className="mt-2 space-y-1">
                            {aiResult.capabilities.map((c, i) => (
                              <p key={i} className="flex items-center gap-2 text-xs">
                                <span className="text-primary">{i + 1}.</span>
                                {c.title}
                                {c.prerequisites.length > 0 && (
                                  <span className="text-[10px] text-muted-foreground">
                                    前置: {c.prerequisites.join('、')}
                                  </span>
                                )}
                              </p>
                            ))}
                          </div>
                          <div className="mt-2 flex gap-2">
                            <Button size="sm" className="h-6 text-xs" onClick={saveAiJourney} disabled={saving}>
                              {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                              {t('growth.confirmSave')}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={discardAiJourney}>
                              {t('common.cancel')}
                            </Button>
                          </div>
                        </div>
                      )}

                      {journeys.length === 0 && !aiResult && (
                        <p className="py-3 text-center text-xs text-muted-foreground">
                          {t('growth.noJourneys')}
                        </p>
                      )}
                      {journeys.map((journey) => (
                        <div key={journey.id} className="rounded-md border border-border p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{journey.title}</p>
                              {journey.description && (
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {journey.description}
                                </p>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-destructive"
                              title={t('common.delete')}
                              onClick={() =>
                                setDeleteTarget({ kind: 'journey', id: journey.id, title: journey.title })
                              }
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                          <div className="mt-2 space-y-1">
                            {journey.capabilities.map((cap, idx) => (
                              <div
                                key={cap.id}
                                className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/40"
                              >
                                <span className="w-4 shrink-0 text-[10px] text-muted-foreground">
                                  {idx + 1}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-xs">{cap.title}</span>
                                <span
                                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${CAP_STATUS_STYLE[cap.status] || CAP_STATUS_STYLE.locked}`}
                                >
                                  {t(`growth.capStatus${cap.status.charAt(0).toUpperCase()}${cap.status.slice(1)}`)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Goal 新建/编辑对话框 */}
      <Dialog open={!!goalDialog} onOpenChange={(open) => !open && setGoalDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {goalDialog?.editing ? t('growth.editGoal') : t('growth.newGoal')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t('growth.goalTitle')} *</Label>
              <Input
                value={goalForm.title}
                onChange={(e) => setGoalForm((f) => ({ ...f, title: e.target.value }))}
                placeholder={t('growth.goalTitlePlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('growth.goalDescription')}</Label>
              <Textarea
                value={goalForm.description}
                onChange={(e) => setGoalForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGoalDialog(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={saveGoal} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI 生成 Goal */}
      <Dialog open={!!aiGoalResult || aiGoalLoading} onOpenChange={(open) => !open && setAiGoalResult(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('growth.aiGenerateGoal')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t('growth.goalPrompt')}</Label>
              <Textarea
                value={aiGoalPrompt}
                onChange={(e) => setAiGoalPrompt(e.target.value)}
                rows={3}
                placeholder={t('growth.goalPromptPlaceholder')}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={runAiGoal}
                disabled={!aiGoalPrompt.trim() || aiGoalLoading}
              >
                {aiGoalLoading ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="mr-1 h-3.5 w-3.5" />
                )}
                {aiGoalLoading ? t('growth.generating') : t('growth.aiGenerateGoal')}
              </Button>
            </div>
            {aiGoalResult && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                <p className="font-medium">{aiGoalResult.title}</p>
                {aiGoalResult.description && (
                  <p className="mt-1 text-xs text-muted-foreground">{aiGoalResult.description}</p>
                )}
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={saveAiGoal} disabled={saving}>
                    {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    {t('growth.confirmSave')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAiGoalResult(null)}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 确认删除 */}
      <ConfirmDialog
        open={!!deleteTarget}
        destructive
        title={deleteTarget ? t('growth.deleteConfirm', { title: deleteTarget.title }) : ''}
        onConfirm={deleteTarget?.kind === 'goal' ? deleteGoal : deleteJourney}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
