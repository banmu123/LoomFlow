'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Play, Loader2, Save, Wand2, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { WORKFLOW_TEMPLATES, normalizeWorkflowModels } from '@/lib/workflow-templates';
import type { WorkflowTemplate } from '@/lib/workflow-templates';

// ===== 模板直达运行页 =====
// 核心体验：选模板 → 填参数 → 运行 → 出结果（不碰画布）
// 让"平民自动化"真正落地：打开即用，填一下就能干活

interface ParamDef {
  name: string;
  label: string;
  defaultValue?: string;
}

interface RunResult {
  outputs: unknown;
  error?: string;
}

export default function TemplateRunPage() {
  const t = useT();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const template = useMemo(
    () => WORKFLOW_TEMPLATES.find((tp) => tp.id === params.id),
    [params.id],
  );

  // 解析模板输入参数（从 startNode.parameters）
  const paramDefs = useMemo<ParamDef[]>(() => {
    if (!template) return [];
    const start = template.data.nodes.find((n) => n.type === 'startNode');
    const paramsRaw = start?.data?.parameters;
    if (!Array.isArray(paramsRaw)) return [];
    return paramsRaw.map((p) => {
      const obj = p as { name?: string; label?: string; defaultValue?: string };
      return {
        name: obj.name ?? '',
        label: obj.label ?? obj.name ?? '',
        defaultValue: obj.defaultValue ?? '',
      };
    });
  }, [template]);

  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    if (paramDefs.length === 0) return;
    setValues((prev) => {
      const next = { ...prev };
      for (const p of paramDefs) {
        if (next[p.name] === undefined) next[p.name] = p.defaultValue ?? '';
      }
      return next;
    });
  }, [paramDefs]);

  if (!template) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <p className="text-muted-foreground">{t('templates.notFound')}</p>
        <Button variant="outline" onClick={() => router.push('/chat')}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          {t('common.back')}
        </Button>
      </div>
    );
  }

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
    setRunError(null);
    try {
      // 规范化模型（llmId 替换为用户配置的第一个模型）
      const data = JSON.parse(JSON.stringify(template.data));
      await normalizeWorkflowModels(data);

      const inputs: Record<string, unknown> = {};
      for (const p of paramDefs) {
        inputs[p.name] = (values[p.name] ?? '').trim();
      }

      const res = await fetch('/api/flow/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flowData: data, inputs }),
      });
      const data2 = await res.json();
      if (data2.status === 'failed' || !res.ok) {
        setRunError(data2.error || data2.message || '运行失败');
        return;
      }
      // 输出：outputs 对象中取出第一个有值的字段
      const outputs = data2.outputs as Record<string, unknown> | undefined;
      const firstVal = outputs
        ? Object.values(outputs).find((v) => v !== undefined && v !== null && v !== '')
        : undefined;
      setResult(typeof firstVal === 'string' ? firstVal : JSON.stringify(firstVal ?? outputs ?? '', null, 2));
    } catch {
      setRunError('网络错误，请重试');
    } finally {
      setRunning(false);
    }
  };

  const handleSaveToCanvas = async () => {
    try {
      const data = JSON.parse(JSON.stringify(template.data));
      await normalizeWorkflowModels(data);
      const { setPendingWorkflow } = await import('@/lib/pending-workflow');
      setPendingWorkflow(data);
      router.push('/workflows/editor');
    } catch {
      toast.error(t('templates.saveFailed'));
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
        {/* 头部 */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => router.push('/chat')}
            className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('common.back')}
          </button>
          <Button variant="ghost" size="sm" onClick={handleSaveToCanvas}>
            <Wand2 className="mr-1 h-3.5 w-3.5" />
            {t('templates.openInCanvas')}
          </Button>
        </div>

        {/* 模板信息 */}
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-start gap-4">
            <span className="text-4xl">{template.emoji}</span>
            <div>
              <h1 className="text-xl font-semibold">{template.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{template.description}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {template.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 参数填写 */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 text-sm font-medium text-muted-foreground">{t('templates.fillInputs')}</h2>
          <div className="space-y-4">
            {paramDefs.map((p) => (
              <div key={p.name} className="space-y-1.5">
                <Label>{p.label || p.name}</Label>
                {p.name === 'data' || p.name === 'notes' || p.name === 'doc' ||
                 p.name === 'contract' || p.name === 'code' || p.name === 'complaint' ||
                 p.name === 'draft' || p.name === 'goals' || p.name === 'work' ||
                 p.name === 'product' ? (
                  <Textarea
                    value={values[p.name] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
                    rows={5}
                    placeholder={t('templates.pasteContent')}
                    className="text-sm"
                  />
                ) : (
                  <Input
                    value={values[p.name] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
                    placeholder={t('templates.inputPlaceholder')}
                    className="text-sm"
                  />
                )}
              </div>
            ))}
          </div>

          <Button
            className="mt-6 w-full"
            size="lg"
            onClick={handleRun}
            disabled={running || paramDefs.some((p) => !(values[p.name] ?? '').trim())}
          >
            {running ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            {running ? t('templates.running') : t('templates.run')}
          </Button>
        </div>

        {/* 结果 */}
        {(result || runError) && (
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              {runError ? (
                <XCircle className="h-4 w-4 text-destructive" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              )}
              {runError ? t('templates.runFailed') : t('templates.result')}
            </h2>
            {runError ? (
              <p className="whitespace-pre-wrap text-sm text-destructive">{runError}</p>
            ) : (
              <pre className="whitespace-pre-wrap rounded-lg bg-muted/40 p-4 text-sm leading-relaxed">
                {result}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
