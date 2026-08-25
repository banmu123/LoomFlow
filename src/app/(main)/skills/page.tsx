'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sparkles,
  Play,
  CopyPlus,
  Share2,
  Archive,
  Trash2,
  Loader2,
  GitBranch,
  Plus,
  History,
  Layers,
  LineChart,
  Wand2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import type { SkillRecord, SkillDefinition, SkillQualityResult } from '@/lib/skill-types-client';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

interface WorkflowOption {
  id: string;
  title: string;
}

const STATUS_LABEL: Record<SkillRecord['status'], string> = {
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
};

export default function SkillsPage() {
  const router = useRouter();
  const t = useT();
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // NL 创建
  const [nlOpen, setNlOpen] = useState(false);
  const [naturalLanguage, setNaturalLanguage] = useState('');
  const [nlLoading, setNlLoading] = useState(false);
  const [skillDraft, setSkillDraft] = useState<{
    skill: SkillDefinition;
    workflow: unknown;
    validation: { canCreate: boolean; skill: { valid: boolean }; workflow: { valid: boolean; errors: string[] } };
  } | null>(null);

  // 从工作流创建
  const [fromWfOpen, setFromWfOpen] = useState(false);
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [selectedWf, setSelectedWf] = useState<string>('');

  // 发布
  const [publishTarget, setPublishTarget] = useState<SkillRecord | null>(null);
  const [pubWeb, setPubWeb] = useState(true);
  const [pubApi, setPubApi] = useState(false);
  const [pubShare, setPubShare] = useState(false);
  const [pubLoading, setPubLoading] = useState(false);

  // 质量
  const [qualityTarget, setQualityTarget] = useState<SkillRecord | null>(null);
  const [quality, setQuality] = useState<SkillQualityResult | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<SkillRecord | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/skills');
      const data = await res.json();
      if (Array.isArray(data)) setSkills(data);
    } catch {
      toast.error('加载 Skills 失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const handleRun = (s: SkillRecord) => router.push(`/skills/${s.id}`);

  const handleViewWorkflow = (s: SkillRecord) => {
    router.push(`/workflows/editor?skill=${s.id}`);
  };

  const handleDuplicate = async (s: SkillRecord) => {
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: s.workflowId,
          workflowVersion: s.workflowVersion,
          title: `${s.title}（副本）`,
          definition: s.definition,
          executionPolicy: s.executionPolicy,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`已创建副本「${data.title}」`);
        loadSkills();
      } else {
        toast.error(data?.error || '复制失败');
      }
    } catch {
      toast.error('复制失败');
    }
  };

  const handleArchive = async (s: SkillRecord) => {
    setArchivingId(s.id);
    try {
      const target = s.status === 'archived' ? 'draft' : 'archived';
      const res = await fetch(`/api/skills/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: target }),
      });
      if (res.ok) {
        toast.success(target === 'archived' ? '已归档' : '已恢复为草稿');
        loadSkills();
      }
    } catch {
      toast.error('操作失败');
    } finally {
      setArchivingId(null);
    }
  };

  const handleDelete = async (s: SkillRecord) => {
    setDeleteTarget(null);
    try {
      const res = await fetch(`/api/skills/${s.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('已删除');
        loadSkills();
      } else {
        toast.error('删除失败');
      }
    } catch {
      toast.error('删除失败');
    }
  };

  // ===== 自然语言 → Skill 创建 =====
  const loadWorkflows = useCallback(async () => {
    try {
      const res = await fetch('/api/workflow-history');
      const data = await res.json();
      if (Array.isArray(data)) setWorkflows(data.map((w) => ({ id: w.id, title: w.title })));
    } catch {
      // ignore
    }
  }, []);

  const generateSkill = async () => {
    if (!naturalLanguage.trim()) {
      toast.error('请描述你想自动化的能力');
      return;
    }
    setNlLoading(true);
    try {
      const res = await fetch('/api/nl-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: naturalLanguage }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || '生成失败');
        return;
      }
      setSkillDraft(data);
    } catch {
      toast.error('生成失败，请稍后重试');
    } finally {
      setNlLoading(false);
    }
  };

  // 批准并创建：保存工作流 → 用新的 workflowId 创建 Skill
  const approveSkill = async () => {
    if (!skillDraft) return;
    try {
      const wfRes = await fetch('/api/workflow-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: skillDraft.skill.name, data: skillDraft.workflow }),
      });
      const wf = await wfRes.json();
      if (!wfRes.ok) {
        toast.error(wf?.error || '保存工作流失败');
        return;
      }
      const sRes = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId: wf.id, title: skillDraft.skill.name, definition: skillDraft.skill }),
      });
      const s = await sRes.json();
      if (sRes.ok) {
        toast.success(`Skill「${s.title}」已创建`);
        setNlOpen(false);
        setSkillDraft(null);
        setNaturalLanguage('');
        loadSkills();
      } else {
        toast.error(s?.error || '创建 Skill 失败');
      }
    } catch {
      toast.error('创建失败');
    }
  };

  const createFromWorkflow = async () => {
    if (!selectedWf) {
      toast.error('请选择一个工作流');
      return;
    }
    // 打开简化的定义填写? 这里用默认定义（从工作流生成一个最小 Skill 定义）
    const def: SkillDefinition = {
      schemaVersion: 1,
      name: '',
      description: '',
      inputs: { fields: [] },
      outputs: { fields: [] },
      examples: [],
    };
    // 简化：直接创建，标题用工作流名，输入输出留空（用户后续在详情页编辑）
    try {
      const sRes = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId: selectedWf, title: '未命名 Skill', definition: def }),
      });
      const s = await sRes.json();
      if (sRes.ok) {
        toast.success(`已创建 Skill「${s.title}」，请到详情页完善输入输出定义`);
        setFromWfOpen(false);
        loadSkills();
      } else {
        toast.error(s?.error || '创建失败');
      }
    } catch {
      toast.error('创建失败');
    }
  };

  // ===== 发布 =====
  const openPublish = (s: SkillRecord) => {
    setPublishTarget(s);
    setPubWeb(s.publishedTargets.webUi);
    setPubApi(s.publishedTargets.api);
    setPubShare(s.publishedTargets.share);
  };

  const handlePublish = async () => {
    if (!publishTarget) return;
    setPubLoading(true);
    try {
      const res = await fetch(`/api/skills/${publishTarget.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets: { webUi: pubWeb, api: pubApi, share: pubShare } }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.note || '已发布');
        setPublishTarget(null);
        loadSkills();
      } else {
        toast.error(data?.error || '发布失败');
      }
    } catch {
      toast.error('发布失败');
    } finally {
      setPubLoading(false);
    }
  };

  // ===== 质量 =====
  const openQuality = async (s: SkillRecord) => {
    setQualityTarget(s);
    setQuality(null);
    try {
      const res = await fetch(`/api/skills/${s.id}/metrics`);
      const data = await res.json();
      if (res.ok) setQuality(data);
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">{t('skills.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('skills.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => { setFromWfOpen(true); loadWorkflows(); }}>
            <GitBranch className="mr-2 h-4 w-4" />
            {t('skills.fromWorkflow')}
          </Button>
          <Button onClick={() => setNlOpen(true)}>
            <Wand2 className="mr-2 h-4 w-4" />
            {t('skills.createSkill')}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            {t('common.loading')}
          </div>
        ) : skills.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-20 text-center">
            <Sparkles className="h-10 w-10 text-primary/40" />
            <p className="text-muted-foreground">{t('skills.empty')}</p>
            <Button onClick={() => setNlOpen(true)}>
              <Wand2 className="mr-2 h-4 w-4" />
              {t('skills.fromNaturalLanguage')}
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {skills.map((s) => (
              <Card key={s.id} className="flex flex-col gap-3 p-4 transition-colors hover:border-primary/40">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                      <Sparkles className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-medium text-foreground">{s.title}</h3>
                      <p className="text-xs text-muted-foreground">v{s.version}</p>
                    </div>
                  </div>
                  <Badge variant={s.status === 'published' ? 'default' : s.status === 'archived' ? 'secondary' : 'outline'}>
                    {STATUS_LABEL[s.status]}
                  </Badge>
                </div>

                <p className="line-clamp-2 flex-1 text-sm text-muted-foreground">
                  {s.definition.description || '（无描述）'}
                </p>

                <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                  <span className="rounded bg-muted px-1.5 py-0.5">
                    输入 {s.definition.inputs.fields.length} · 输出 {s.definition.outputs.fields.length}
                  </span>
                  {s.publishedTargets.webUi && <span className="rounded bg-muted px-1.5 py-0.5">Web UI</span>}
                  {s.publishedTargets.api && <span className="rounded bg-muted px-1.5 py-0.5">API</span>}
                  {s.publishedTargets.share && <span className="rounded bg-muted px-1.5 py-0.5">Share</span>}
                </div>

                <div className="border-t border-border pt-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                    <button onClick={() => handleRun(s)} className="inline-flex items-center gap-1 text-primary hover:underline">
                      <Play className="h-3 w-3" /> {t('skills.run')}
                    </button>
                    <button onClick={() => router.push(`/skills/${s.id}?edit=1`)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                      编辑
                    </button>
                    <button onClick={() => handleDuplicate(s)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                      <CopyPlus className="h-3 w-3" /> {t('skills.duplicate')}
                    </button>
                    <button onClick={() => handleViewWorkflow(s)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                      <GitBranch className="h-3 w-3" /> {t('skills.viewWorkflow')}
                    </button>
                    <button onClick={() => router.push(`/skills/${s.id}?tab=runs`)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                      <History className="h-3 w-3" /> {t('skills.viewRuns')}
                    </button>
                    <button onClick={() => router.push(`/skills/${s.id}?tab=versions`)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                      <Layers className="h-3 w-3" /> {t('skills.viewVersions')}
                    </button>
                    <button onClick={() => openQuality(s)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                      <LineChart className="h-3 w-3" /> {t('skills.quality')}
                    </button>
                  </div>
                  <div className="mt-2.5 flex items-center gap-2 border-t border-border/60 pt-2.5">
                    <Button size="sm" className="flex-1" onClick={() => handleRun(s)}>
                      <Play className="mr-1 h-3.5 w-3.5" /> {t('skills.runThis')}
                    </Button>
                    <Button size="sm" variant={s.status === 'published' ? 'ghost' : 'default'} onClick={() => openPublish(s)}>
                      {s.status === 'published' ? <Share2 className="mr-1 h-3.5 w-3.5" /> : <Share2 className="mr-1 h-3.5 w-3.5" />}
                      {s.status === 'published' ? t('skills.publish') : t('skills.publish')}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleArchive(s)} disabled={archivingId === s.id}>
                      <Archive className="mr-1 h-3.5 w-3.5" />
                      {s.status === 'archived' ? '恢复' : t('skills.archive')}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteTarget(s)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* 自然语言创建对话框 */}
      <Dialog open={nlOpen} onOpenChange={(o) => { setNlOpen(o); if (!o) { setSkillDraft(null); setNaturalLanguage(''); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('skills.fromNaturalLanguage')}</DialogTitle>
            <DialogDescription>{t('skills.whatToAutomate')}</DialogDescription>
          </DialogHeader>
          {!skillDraft ? (
            <div className="space-y-3 py-2">
              <Textarea
                rows={4}
                placeholder={t('skills.nlPlaceholder')}
                value={naturalLanguage}
                onChange={(e) => setNaturalLanguage(e.target.value)}
              />
              <div className="flex justify-end">
                <Button onClick={generateSkill} disabled={nlLoading}>
                  {nlLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t('skills.generate')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="max-h-[60vh] space-y-4 overflow-y-auto py-2">
              <div>
                <h4 className="text-sm font-semibold">{skillDraft.skill.name}</h4>
                <p className="text-sm text-muted-foreground">{skillDraft.skill.description}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-md border border-border p-3">
                  <p className="mb-1 text-xs font-medium text-foreground">输入</p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {skillDraft.skill.inputs.fields.length === 0 && <li>（无）</li>}
                    {skillDraft.skill.inputs.fields.map((f) => (
                      <li key={f.name}>
                        {f.name} <span className="text-muted-foreground/60">({f.type}{f.required ? ' *' : ''})</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-md border border-border p-3">
                  <p className="mb-1 text-xs font-medium text-foreground">输出</p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {skillDraft.skill.outputs.fields.length === 0 && <li>（无）</li>}
                    {skillDraft.skill.outputs.fields.map((f) => (
                      <li key={f.name}>{f.name} <span className="text-muted-foreground/60">({f.type})</span></li>
                    ))}
                  </ul>
                </div>
              </div>
              {/* 校验状态 */}
              <div className="rounded-md border border-border p-3">
                <p className="mb-1 text-xs font-medium">校验</p>
                {skillDraft.validation.canCreate ? (
                  <div className="flex items-center gap-1 text-xs text-green-600">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {t('skills.validationOk')}
                  </div>
                ) : (
                  <div className="flex items-start gap-1 text-xs text-red-600">
                    <XCircle className="mt-0.5 h-3.5 w-3.5" />
                    <div>
                      {t('skills.validationFail')}
                      {skillDraft.validation.workflow.errors.length > 0 && (
                        <ul className="mt-1 list-inside list-disc">
                          {skillDraft.validation.workflow.errors.map((e, i) => <li key={i}>{e}</li>)}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          {skillDraft && (
            <DialogFooter>
              <Button variant="outline" onClick={() => setSkillDraft(null)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={approveSkill} disabled={!skillDraft.validation.canCreate}>
                {t('skills.approveCreate')}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* 从工作流创建 */}
      <Dialog open={fromWfOpen} onOpenChange={setFromWfOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('skills.fromWorkflow')}</DialogTitle>
            <DialogDescription>选择一个已保存的工作流，封装为 Skill</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Select value={selectedWf} onValueChange={setSelectedWf}>
              <SelectTrigger>
                <SelectValue placeholder="选择工作流" />
              </SelectTrigger>
              <SelectContent>
                {workflows.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFromWfOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={createFromWorkflow}><Plus className="mr-1 h-4 w-4" /> 创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 发布对话框 */}
      <Dialog open={!!publishTarget} onOpenChange={(o) => !o && setPublishTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>发布 Skill</DialogTitle>
            <DialogDescription>「{publishTarget?.title}」将按所选目标发布（发布前会跑绑定测试）</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium">Web UI</p>
                <p className="text-xs text-muted-foreground">在独立 Skill 页面使用</p>
              </div>
              <Switch checked={pubWeb} onCheckedChange={setPubWeb} />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium">API</p>
                <p className="text-xs text-muted-foreground">POST /api/skills/{publishTarget?.id}/execute（API Key）</p>
              </div>
              <Switch checked={pubApi} onCheckedChange={setPubApi} />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium">Share Link</p>
                <p className="text-xs text-muted-foreground">生成公开共享链接</p>
              </div>
              <Switch checked={pubShare} onCheckedChange={setPubShare} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishTarget(null)}>{t('common.cancel')}</Button>
            <Button onClick={handlePublish} disabled={pubLoading}>
              {pubLoading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t('skills.publish')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 质量对话框 */}
      <Dialog
        open={!!qualityTarget}
        onOpenChange={(o) => {
          if (!o) { setQualityTarget(null); setQuality(null); }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('skills.quality')} — {qualityTarget?.title}</DialogTitle>
          </DialogHeader>
          {!quality ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 计算中...
            </div>
          ) : (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-md border border-border p-2.5">
                  <p className="text-xs text-muted-foreground">质量分</p>
                  <p className="text-lg font-semibold text-foreground">{quality.quality.qualityScore}</p>
                </div>
                <div className="rounded-md border border-border p-2.5">
                  <p className="text-xs text-muted-foreground">风险</p>
                  <p className="text-lg font-semibold">{quality.quality.risk === 'high' ? '高' : quality.quality.risk === 'medium' ? '中' : '低'}</p>
                </div>
                <div className="rounded-md border border-border p-2.5">
                  <p className="text-xs text-muted-foreground">成功率</p>
                  <p className="font-medium">{quality.quality.successRate}%</p>
                </div>
                <div className="rounded-md border border-border p-2.5">
                  <p className="text-xs text-muted-foreground">平均耗时</p>
                  <p className="font-medium">{quality.quality.latencyMs}ms</p>
                </div>
                <div className="rounded-md border border-border p-2.5">
                  <p className="text-xs text-muted-foreground">Token</p>
                  <p className="font-medium">{quality.quality.tokenUsage}</p>
                </div>
                <div className="rounded-md border border-border p-2.5">
                  <p className="text-xs text-muted-foreground">运行数</p>
                  <p className="font-medium">{quality.quality.totalRuns}</p>
                </div>
              </div>
              <div className="rounded-md border border-border p-3">
                <p className="mb-1 text-xs font-medium text-foreground">{t('skills.improvements')}</p>
                <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                  {quality.improvements.map((im, i) => <li key={i}>{im}</li>)}
                </ul>
              </div>
            </div>
          )}
          <DialogFooter><Button onClick={() => setQualityTarget(null)}>关闭</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!deleteTarget}
        destructive
        title={`确定要删除 Skill「${deleteTarget?.title ?? ''}」吗？`}
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
