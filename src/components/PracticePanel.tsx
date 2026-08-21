'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Plus,
  Trash2,
  Play,
  CheckCircle2,
  Clock,
  Loader2,
  Code2,
  GitBranch,
  FolderOpen,
  Lightbulb,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Practice, PracticeType, PracticeDifficulty } from '@/lib/growth/types';
import { PRACTICE_TYPES, PRACTICE_DIFFICULTIES } from '@/lib/growth/types';

const PRACTICE_TYPE_META: Record<
  PracticeType,
  { icon: typeof Code2; colorClass: string }
> = {
  code: { icon: Code2, colorClass: 'bg-blue-500/10 text-blue-600' },
  workflow: { icon: GitBranch, colorClass: 'bg-amber-500/10 text-amber-600' },
  project: { icon: FolderOpen, colorClass: 'bg-green-500/10 text-green-600' },
  reflection: { icon: Lightbulb, colorClass: 'bg-purple-500/10 text-purple-600' },
};

const DIFFICULTY_META: Record<PracticeDifficulty, { colorClass: string }> = {
  beginner: { colorClass: 'bg-green-500/10 text-green-600 border-green-500/30' },
  intermediate: { colorClass: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
  advanced: { colorClass: 'bg-red-500/10 text-red-600 border-red-500/30' },
};

export function PracticePanel({
  capabilityId,
  onUpdate,
}: {
  capabilityId: string;
  onUpdate?: () => void;
}) {
  const t = useT();
  const [practices, setPractices] = useState<Practice[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);

  // 新建对话框
  const [createDialog, setCreateDialog] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    type: 'code' as PracticeType,
    difficulty: 'beginner' as PracticeDifficulty,
    instructions: '',
  });
  const [saving, setSaving] = useState(false);

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<Practice | null>(null);

  // 完成中
  const [completing, setCompleting] = useState<string | null>(null);

  const loadPractices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/growth/practices?capabilityId=${encodeURIComponent(capabilityId)}`,
      );
      const data = await res.json();
      if (Array.isArray(data)) setPractices(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [capabilityId]);

  useEffect(() => {
    loadPractices();
  }, [loadPractices]);

  const createPractice = async () => {
    if (!form.title.trim()) {
      toast.error(t('growth.practiceTitle') + ' ' + t('growth.goalTitleRequired'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/growth/practices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, capability_id: capabilityId }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(t('growth.practiceCreated'));
        setCreateDialog(false);
        setForm({
          title: '',
          description: '',
          type: 'code',
          difficulty: 'beginner',
          instructions: '',
        });
        loadPractices();
      } else {
        toast.error(data?.error || t('growth.saveFailed'));
      }
    } catch {
      toast.error(t('growth.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const deletePractice = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/growth/practices/${deleteTarget.id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        toast.success(t('growth.practiceDeleted'));
        loadPractices();
      } else {
        toast.error(t('growth.deleteFailed'));
      }
    } catch {
      toast.error(t('growth.deleteFailed'));
    } finally {
      setDeleteTarget(null);
    }
  };

  const completePractice = async (practice: Practice) => {
    if (completing) return;
    setCompleting(practice.id);
    try {
      const res = await fetch(`/api/growth/practices/${practice.id}/complete`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(t('growth.practiceCompletedEvidence'));
        loadPractices();
        onUpdate?.();
      } else {
        toast.error(data?.error || t('growth.saveFailed'));
      }
    } catch {
      toast.error(t('growth.saveFailed'));
    } finally {
      setCompleting(null);
    }
  };

  const startPractice = async (practice: Practice) => {
    try {
      const res = await fetch(`/api/growth/practices/${practice.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' }),
      });
      if (res.ok) {
        loadPractices();
      }
    } catch {
      // ignore
    }
  };

  const pendingCount = practices.filter((p) => p.status === 'pending').length;
  const completedCount = practices.filter((p) => p.status === 'completed').length;

  return (
    <div className="rounded-md border border-border">
      {/* 头部 */}
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="flex-1 text-xs font-medium text-muted-foreground">
          {t('growth.practices')}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {completedCount}/{practices.length}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          title={t('growth.practiceNew')}
          onClick={(e) => {
            e.stopPropagation();
            setCreateDialog(true);
          }}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </button>

      {/* 列表 */}
      {expanded && (
        <div className="border-t border-border/60 px-3 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            </div>
          ) : practices.length === 0 ? (
            <p className="py-3 text-center text-[11px] text-muted-foreground">
              {t('growth.practiceEmpty')}
            </p>
          ) : (
            <div className="space-y-1.5">
              {practices.map((p) => {
                const typeMeta = PRACTICE_TYPE_META[p.type] ?? PRACTICE_TYPE_META.code;
                const TypeIcon = typeMeta.icon;
                const diffMeta = DIFFICULTY_META[p.difficulty] ?? DIFFICULTY_META.beginner;
                const isCompleted = p.status === 'completed';
                const isCompleting = completing === p.id;
                return (
                  <div
                    key={p.id}
                    className={cn(
                      'group flex items-start gap-2 rounded-md border px-2.5 py-2 transition-colors',
                      isCompleted
                        ? 'border-green-500/30 bg-green-500/5'
                        : 'border-border hover:border-primary/30',
                    )}
                  >
                    {/* 类型图标 */}
                    <span
                      className={cn(
                        'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded',
                        typeMeta.colorClass,
                      )}
                    >
                      <TypeIcon className="h-3 w-3" />
                    </span>

                    {/* 内容 */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            'truncate text-xs font-medium',
                            isCompleted
                              ? 'text-muted-foreground line-through'
                              : 'text-foreground',
                          )}
                        >
                          {p.title}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn('shrink-0 px-1 py-0 text-[9px]', diffMeta.colorClass)}
                        >
                          {t(`growth.practiceDifficulty${p.difficulty.charAt(0).toUpperCase()}${p.difficulty.slice(1)}`)}
                        </Badge>
                      </div>
                      {p.description && (
                        <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                          {p.description}
                        </p>
                      )}
                      {p.instructions && !isCompleted && (
                        <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground/80">
                          {p.instructions}
                        </p>
                      )}
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex shrink-0 items-center gap-1">
                      {isCompleted ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <>
                          {p.status === 'pending' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              title={t('growth.practiceStart')}
                              onClick={() => startPractice(p)}
                            >
                              <Play className="h-3 w-3" />
                            </Button>
                          )}
                          {p.status === 'in_progress' && (
                            <Clock className="h-3.5 w-3.5 text-amber-500" />
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-green-600"
                            title={t('growth.practiceComplete')}
                            onClick={() => completePractice(p)}
                            disabled={isCompleting}
                          >
                            {isCompleting ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-3 w-3" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive opacity-0 group-hover:opacity-100"
                            title={t('common.delete')}
                            onClick={() => setDeleteTarget(p)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 提示 */}
          {practices.length > 0 && pendingCount > 0 && (
            <p className="mt-2 text-center text-[10px] text-muted-foreground/60">
              {t('growth.practiceFlowHint')}
            </p>
          )}
        </div>
      )}

      {/* 新建练习对话框 */}
      <Dialog open={createDialog} onOpenChange={(open) => !open && setCreateDialog(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('growth.practiceNew')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>{t('growth.practiceTitle')} *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder={t('growth.practiceTitlePlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('growth.practiceDescription')}</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('growth.practiceType')}</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) => setForm((f) => ({ ...f, type: v as PracticeType }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRACTICE_TYPES.map((pt) => (
                      <SelectItem key={pt} value={pt}>
                        {t(`growth.practiceType${pt.charAt(0).toUpperCase()}${pt.slice(1)}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('growth.practiceDifficulty')}</Label>
                <Select
                  value={form.difficulty}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, difficulty: v as PracticeDifficulty }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRACTICE_DIFFICULTIES.map((pd) => (
                      <SelectItem key={pd} value={pd}>
                        {t(`growth.practiceDifficulty${pd.charAt(0).toUpperCase()}${pd.slice(1)}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('growth.practiceInstructions')}</Label>
              <Textarea
                value={form.instructions}
                onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
                placeholder={t('growth.practiceInstructionsPlaceholder')}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={createPractice} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!deleteTarget}
        destructive
        title={deleteTarget ? t('growth.practiceDeleteConfirm', { title: deleteTarget.title }) : ''}
        onConfirm={deletePractice}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
