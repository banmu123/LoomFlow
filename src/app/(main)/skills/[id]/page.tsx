'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  Play,
  Loader2,
  GitBranch,
  ArrowLeft,
  History,
  Layers,
  LineChart,
  Save,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { SkillRecord, SkillRunResult, SkillQualityResult, SkillField } from '@/lib/skill-types-client';

interface VersionRow {
  id: string;
  version: number;
  workflow_version: number | null;
  title: string;
  status: string;
  created_at: string;
}
interface RunRow {
  id: string;
  status: string;
  duration_ms: number;
  token_usage: number;
  error: string | null;
  ran_at: string;
}
interface TestRow {
  testCaseId: string;
  name: string;
  status: string;
  message?: string;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

const FIELD_TYPES = ['string', 'number', 'boolean', 'textarea', 'select', 'array', 'object'];

export default function SkillDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useT();
  const searchParams = useSearchParams();
  const skillId = params.id;

  const [skill, setSkill] = useState<SkillRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'run' | 'runs' | 'versions' | 'quality'>(searchParams.get('tab') === 'runs' ? 'runs' : searchParams.get('tab') === 'versions' ? 'versions' : searchParams.get('tab') === 'quality' ? 'quality' : 'run');
  const editMode = searchParams.get('edit') === '1';

  // 运行
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<SkillRunResult | null>(null);

  // 列表
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [quality, setQuality] = useState<SkillQualityResult | null>(null);
  // 测试
  const [testing, setTesting] = useState(false);
  const [testOutcome, setTestOutcome] = useState<{ passed: number; failed: number; error: number; total: number; results?: TestRow[] } | null>(null);
  const [testGate, setTestGate] = useState<{ canPublish: boolean; publishReason?: string } | null>(null);

  // 编辑
  const [titleEdit, setTitleEdit] = useState('');
  const [descEdit, setDescEdit] = useState('');
  const [inputsEdit, setInputsEdit] = useState<SkillField[]>([]);
  const [outputsEdit, setOutputsEdit] = useState<SkillField[]>([]);
  const [saving, setSaving] = useState(false);

  const loadSkill = useCallback(async () => {
    try {
      const res = await fetch(`/api/skills/${skillId}`);
      const data = await res.json();
      if (res.ok) {
        setSkill(data);
        setTitleEdit(data.title);
        setDescEdit(data.definition.description ?? '');
        setInputsEdit(data.definition.inputs.fields);
        setOutputsEdit(data.definition.outputs.fields);
        // 初始化表单默认值
        const init: Record<string, unknown> = {};
        for (const f of data.definition.inputs.fields) {
          if (f.defaultValue !== undefined) init[f.name] = f.defaultValue;
          else if (f.type === 'boolean') init[f.name] = false;
        }
        setFormValues(init);
      }
    } catch {
      toast.error('加载 Skill 失败');
    } finally {
      setLoading(false);
    }
  }, [skillId]);

  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch(`/api/skills/${skillId}/runs?limit=20`);
      const data = await res.json();
      if (res.ok && Array.isArray(data.runs)) setRuns(data.runs);
    } catch {
      // ignore
    }
  }, [skillId]);

  const loadVersions = useCallback(async () => {
    try {
      const res = await fetch(`/api/skills/${skillId}/versions`);
      const data = await res.json();
      if (res.ok && Array.isArray(data.versions)) setVersions(data.versions);
    } catch {
      // ignore
    }
  }, [skillId]);

  const handleRunTests = useCallback(async () => {
    setTesting(true);
    setTestOutcome(null);
    try {
      const res = await fetch(`/api/skills/${skillId}/tests`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setTestOutcome(data.outcome);
        setTestGate({ canPublish: data.canPublish, publishReason: data.publishReason });
        toast.success(`测试完成：${data.outcome.passed}/${data.outcome.total} 通过`);
      } else {
        toast.error(data?.error || '测试失败');
      }
    } catch {
      toast.error('测试失败');
    } finally {
      setTesting(false);
    }
  }, [skillId]);

  const loadAll = useCallback(() => {
    loadSkill();
    loadRuns();
  }, [loadSkill, loadRuns]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (tab === 'runs') loadRuns();
    if (tab === 'versions') loadVersions();
    if (tab === 'quality') {
      (async () => {
        try {
          const res = await fetch(`/api/skills/${skillId}/metrics`);
          const data = await res.json();
          if (res.ok) setQuality(data);
        } catch {
          // ignore
        }
      })();
    }
  }, [tab, skillId, loadRuns, loadVersions]);

  // ===== 运行 =====
  const handleRun = async () => {
    if (!skill) return;
    // 收集 input 值
    setRunning(true);
    setRunResult(null);
    try {
      const res = await fetch(`/api/skills/${skillId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: formValues }),
      });
      const data = await res.json();
      setRunResult(data);
      if (!res.ok && data?.error) toast.error(data.error);
      loadRuns();
    } catch {
      toast.error('运行失败');
    } finally {
      setRunning(false);
    }
  };

  // ===== 保存编辑 =====
  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/skills/${skillId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: titleEdit,
          definition: {
            schemaVersion: 1,
            name: titleEdit,
            description: descEdit,
            inputs: { fields: inputsEdit },
            outputs: { fields: outputsEdit },
            examples: skill!.definition.examples ?? [],
          },
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('已保存');
        setSkill(data);
        await loadSkill();
      } else {
        toast.error(data?.error || '保存失败');
      }
    } catch {
      toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const updateField = (list: 'inputs' | 'outputs', i: number, patch: Partial<SkillField>) => {
    const target = list === 'inputs' ? inputsEdit : outputsEdit;
    const next = target.map((f, idx) => (idx === i ? { ...f, ...patch } : f));
    if (list === 'inputs') setInputsEdit(next);
    else setOutputsEdit(next);
  };

  const removeField = (list: 'inputs' | 'outputs', i: number) => {
    const target = list === 'inputs' ? inputsEdit : outputsEdit;
    const next = target.filter((_, idx) => idx !== i);
    if (list === 'inputs') setInputsEdit(next);
    else setOutputsEdit(next);
  };

  const addField = (list: 'inputs' | 'outputs') => {
    const item: SkillField = { name: `field_${Date.now()}`, type: 'string' };
    if (list === 'inputs') setInputsEdit([...inputsEdit, item]);
    else setOutputsEdit([...outputsEdit, item]);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> {t('common.loading')}
      </div>
    );
  }

  if (!skill) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <p>Skill 不存在或无权访问</p>
        <Button variant="outline" onClick={() => router.push('/skills')}>
          <ArrowLeft className="mr-1 h-4 w-4" /> 返回 Skills
        </Button>
      </div>
    );
  }

  const renderFieldInput = (f: SkillField) => {
    const value = formValues[f.name] ?? '';
    const update = (v: unknown) => setFormValues((prev) => ({ ...prev, [f.name]: v }));
    switch (f.type) {
      case 'textarea':
        return (
          <Textarea
            rows={3}
            placeholder={f.placeholder || ''}
            value={String(value ?? '')}
            onChange={(e) => update(e.target.value)}
          />
        );
      case 'number':
        return (
          <Input
            type="number"
            placeholder={f.placeholder || ''}
            value={String(value ?? '')}
            onChange={(e) => update(e.target.value === '' ? '' : Number(e.target.value))}
          />
        );
      case 'boolean':
        return (
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!value}
              onChange={(e) => update(e.target.checked)}
              className="h-4 w-4"
            />
            {f.label || f.name}
          </label>
        );
      case 'select':
        return (
          <Select value={String(value ?? '')} onValueChange={update}>
            <SelectTrigger><SelectValue placeholder={f.placeholder || ''} /></SelectTrigger>
            <SelectContent>
              {(f.options ?? []).map((o) => (
                <SelectItem key={String(o.value)} value={String(o.value)}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case 'array':
      case 'object':
        return (
          <Textarea
            rows={3}
            placeholder={f.type === 'array' ? 'JSON 数组，如 ["a","b"]' : 'JSON 对象'}
            value={String(value ?? '')}
            onChange={(e) => {
              let v: unknown = e.target.value;
              try { v = JSON.parse(e.target.value); } catch { v = e.target.value; }
              update(v);
            }}
          />
        );
      default:
        return (
          <Input
            placeholder={f.placeholder || ''}
            value={String(value ?? '')}
            onChange={(e) => update(e.target.value)}
          />
        );
    }
  };

  const renderOutput = (outputs: Record<string, unknown>) => {
    const fields = skill.definition.outputs.fields;
    if (fields.length === 0) {
      return (
        <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
          {JSON.stringify(outputs, null, 2)}
        </pre>
      );
    }
    return (
      <div className="space-y-2">
        {fields.map((f) => {
          const v = outputs[f.name];
          return (
            <div key={f.name} className="rounded-md border border-border p-2.5">
              <p className="mb-1 text-xs font-medium text-foreground">{f.label || f.name}</p>
              {v === undefined ? (
                <p className="text-xs text-muted-foreground">（未返回）</p>
              ) : typeof v === 'object' ? (
                <pre className="max-h-40 overflow-auto text-xs">{JSON.stringify(v, null, 2)}</pre>
              ) : (
                <p className="text-sm">{String(v)}</p>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const tabs: Array<{ key: typeof tab; label: string; icon: typeof Play }> = [
    { key: 'run', label: '运行', icon: Play },
    { key: 'runs', label: t('skills.viewRuns'), icon: History },
    { key: 'versions', label: t('skills.viewVersions'), icon: Layers },
    { key: 'quality', label: t('skills.quality'), icon: LineChart },
  ];

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push('/skills')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold text-foreground">{skill.title}</h1>
            <p className="max-w-xl text-sm text-muted-foreground">{skill.definition.description || '（无描述）'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={skill.status === 'published' ? 'default' : 'outline'}>
            {skill.status === 'published' ? '已发布' : skill.status === 'archived' ? '已归档' : '草稿'}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => router.push(`/workflows/editor?workflowId=${skill.workflowId}`)}>
            <GitBranch className="mr-1 h-4 w-4" /> {t('skills.viewWorkflow')}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border px-6 pt-2">
        {tabs.map((tb) => {
          const Icon = tb.icon;
          return (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === tb.key ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tb.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'run' && (
          <div className="mx-auto grid max-w-4xl gap-6 lg:grid-cols-2">
            {/* 输入表单 */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-muted-foreground">输入</h3>
              {skill.definition.inputs.fields.length === 0 ? (
                <p className="text-sm text-muted-foreground">（该 Skill 无输入参数，直接运行）</p>
              ) : (
                <div className="space-y-3">
                  {skill.definition.inputs.fields.map((f) => (
                    <div key={f.name}>
                      <label className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
                        {f.label || f.name}
                        {f.required && <span className="text-red-500">*</span>}
                      </label>
                      {renderFieldInput(f)}
                      {f.description && <p className="mt-0.5 text-xs text-muted-foreground">{f.description}</p>}
                    </div>
                  ))}
                </div>
              )}

              <Button onClick={handleRun} disabled={running} className="w-full">
                {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                {t('skills.runThis')}
              </Button>

              {/* 测试 */}
              <Button variant="outline" className="w-full" onClick={handleRunTests} disabled={testing}>
                {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                运行测试
              </Button>
              {testOutcome && (
                <div className={`rounded-md border p-3 text-xs ${testOutcome.failed > 0 || testOutcome.error > 0 ? 'border-amber-300 bg-amber-50' : 'border-green-300 bg-green-50'}`}>
                  <p className={`font-medium ${testOutcome.failed > 0 || testOutcome.error > 0 ? 'text-amber-700' : 'text-green-700'}`}>
                    通过 {testOutcome.passed}/{testOutcome.total}，失败 {testOutcome.failed}，错误 {testOutcome.error}
                  </p>
                  {testGate && !testGate.canPublish && (
                    <p className="mt-1 text-amber-700">发布门禁：{testGate.publishReason}</p>
                  )}
                  {(testOutcome.results ?? []).some((r) => r.status !== 'passed') && (
                    <ul className="mt-2 list-inside list-disc space-y-0.5">
                      {(testOutcome.results ?? []).filter((r) => r.status !== 'passed').map((r) => (
                        <li key={r.testCaseId}>{r.name}：{r.message || r.status}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <Button variant="outline" className="w-full" onClick={() => setTab('runs')}>
                <History className="mr-2 h-4 w-4" /> {t('skills.viewRuns')}
              </Button>
            </div>

            {/* 结果 */}
            <div className="space-y-4">
              <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">{t('skills.result')}</h3>
              {!runResult ? (
                <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                  运行后在此显示结果
                </div>
              ) : runResult.status === 'completed' ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <CheckCircle2 className="h-4 w-4" /> 执行完成
                    <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" /> {runResult.durationMs}ms
                    </span>
                  </div>
                  {runResult.outputs && renderOutput(runResult.outputs)}
                  {runResult.tokenUsage > 0 && (
                    <p className="text-xs text-muted-foreground">tokens: {runResult.tokenUsage}</p>
                  )}
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p>{runResult.status === 'timeout' ? '执行超时' : '执行失败'}</p>
                    <p className="mt-1 text-xs">{runResult.error}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'runs' && (
          <div className="mx-auto max-w-4xl">
            {runs.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{t('skills.noRuns')}</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-medium">状态</th>
                      <th className="px-4 py-2.5 text-left font-medium">耗时</th>
                      <th className="px-4 py-2.5 text-left font-medium">tokens</th>
                      <th className="px-4 py-2.5 text-left font-medium">错误</th>
                      <th className="px-4 py-2.5 text-right font-medium">时间</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {runs.map((r) => (
                      <tr key={r.id} className="hover:bg-muted/30">
                        <td className="px-4 py-2.5">
                          <Badge variant={r.status === 'completed' ? 'default' : 'destructive'}>
                            {r.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{r.duration_ms}ms</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{r.token_usage || '-'}</td>
                        <td className="max-w-[200px] truncate px-4 py-2.5 text-xs text-muted-foreground">{r.error || '-'}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">{formatTime(r.ran_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'versions' && (
          <div className="mx-auto max-w-4xl">
            {versions.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">暂无版本历史</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-medium">Skill 版本</th>
                      <th className="px-4 py-2.5 text-left font-medium">关联工作流版本</th>
                      <th className="px-4 py-2.5 text-left font-medium">状态</th>
                      <th className="px-4 py-2.5 text-right font-medium">时间</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {versions.map((v) => (
                      <tr key={v.id} className="hover:bg-muted/30">
                        <td className="px-4 py-2.5 font-medium">v{v.version}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {v.workflow_version ? `Workflow v${v.workflow_version}` : '最新'}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge variant={v.status === 'published' ? 'default' : 'outline'}>{v.status}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">{formatTime(v.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'quality' && (
          <div className="mx-auto max-w-2xl">
            {!quality ? (
              <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /> 计算中...
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-xs text-muted-foreground">质量分</p>
                    <p className="text-2xl font-bold text-foreground">{quality.quality.qualityScore}</p>
                  </div>
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-xs text-muted-foreground">风险</p>
                    <p className="text-2xl font-bold">{quality.quality.risk === 'high' ? '高' : quality.quality.risk === 'medium' ? '中' : '低'}</p>
                  </div>
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-xs text-muted-foreground">成功率</p>
                    <p className="text-2xl font-bold text-foreground">{quality.quality.successRate}%</p>
                  </div>
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-xs text-muted-foreground">平均耗时</p>
                    <p className="text-lg font-semibold">{quality.quality.latencyMs}ms</p>
                  </div>
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-xs text-muted-foreground">平均 Token</p>
                    <p className="text-lg font-semibold">{quality.quality.tokenUsage}</p>
                  </div>
                  <div className="rounded-lg border border-border p-4">
                    <p className="text-xs text-muted-foreground">运行次数</p>
                    <p className="text-lg font-semibold">{quality.quality.totalRuns}</p>
                  </div>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="mb-2 text-sm font-medium text-foreground">{t('skills.improvements')}</p>
                  <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                    {quality.improvements.map((im, i) => <li key={i}>{im}</li>)}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 编辑模式 */}
        {editMode && (
          <div className="mx-auto mt-8 max-w-4xl space-y-6 rounded-lg border border-border p-5">
            <h3 className="text-sm font-semibold">编辑 Skill</h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium">名称</label>
                <Input value={titleEdit} onChange={(e) => setTitleEdit(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">描述</label>
                <Textarea rows={2} value={descEdit} onChange={(e) => setDescEdit(e.target.value)} />
              </div>
            </div>

            {/* 输入字段 */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-medium">输入字段</h4>
                <Button size="sm" variant="outline" onClick={() => addField('inputs')}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> 添加
                </Button>
              </div>
              <div className="space-y-2">
                {inputsEdit.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-md border border-border p-2">
                    <Input className="w-40" value={f.name} onChange={(e) => updateField('inputs', i, { name: e.target.value })} placeholder="字段名" />
                    <Select value={f.type} onValueChange={(v) => updateField('inputs', i, { type: v })}>
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {FIELD_TYPES.map((ft) => <SelectItem key={ft} value={ft}>{ft}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={!!f.required} onChange={(e) => updateField('inputs', i, { required: e.target.checked })} />
                      必填
                    </label>
                    <Button size="icon" variant="ghost" className="text-destructive" onClick={() => removeField('inputs', i)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {/* 输出字段 */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-medium">输出字段</h4>
                <Button size="sm" variant="outline" onClick={() => addField('outputs')}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> 添加
                </Button>
              </div>
              <div className="space-y-2">
                {outputsEdit.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-md border border-border p-2">
                    <Input className="w-40" value={f.name} onChange={(e) => updateField('outputs', i, { name: e.target.value })} placeholder="字段名" />
                    <Select value={f.type} onValueChange={(v) => updateField('outputs', i, { type: v })}>
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {FIELD_TYPES.map((ft) => <SelectItem key={ft} value={ft}>{ft}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input className="flex-1" value={f.description || ''} onChange={(e) => updateField('outputs', i, { description: e.target.value })} placeholder="描述" />
                    <Button size="icon" variant="ghost" className="text-destructive" onClick={() => removeField('outputs', i)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Save className="mr-1 h-4 w-4" /> 保存
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}