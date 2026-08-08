'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  GitBranch,
  Loader2,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useT } from '@/lib/i18n';

interface ShareMeta {
  id: string;
  title: string;
  nodes: Array<{ id: string; type: string; title: string; description: string }>;
  input_parameters: Array<{
    id: string;
    name: string;
    dataType?: string;
    required?: boolean;
    defaultValue?: string;
    description?: string;
  }>;
}

interface NodeEvent {
  type: string;
  data: { nodeId?: string; status?: string; outputs?: Record<string, unknown>; error?: string };
  timestamp: number;
}

const NODE_LABELS: Record<string, string> = {
  startNode: '开始',
  endNode: '结束',
  llmNode: '大模型',
  httpNode: 'HTTP 请求',
  codeNode: '代码',
  templateNode: '模板',
  knowledgeNode: '知识库',
  searchNode: '搜索',
  confirmNode: '人工确认',
  loopNode: '循环',
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}

export default function SharePage() {
  const t = useT();
  const { token } = useParams<{ token: string }>();
  const [meta, setMeta] = useState<ShareMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<NodeEvent[]>([]);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/share/${token}`);
        const data = await res.json();
        if (res.ok && data?.title) {
          setMeta(data);
          // 初始化表单默认值
          const defaults: Record<string, unknown> = {};
          data.input_parameters?.forEach((p: ShareMeta['input_parameters'][0]) => {
            defaults[p.name] = p.defaultValue ?? '';
          });
          setFormValues(defaults);
        } else {
          setError(data?.error || '分享链接无效');
        }
      } catch {
        setError(t('share.loadFailed'));
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const handleRun = useCallback(async () => {
    if (!meta || running) return;
    setRunning(true);
    setEvents([]);
    setRunError(null);
    try {
      const res = await fetch(`/api/share/${token}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: formValues }),
      });
      const data = await res.json();
      if (data.events) setEvents(data.events);
      if (data.status === 'failed') setRunError(data.error || '执行失败');
    } catch {
      setRunError(t('share.networkError'));
    } finally {
      setRunning(false);
    }
  }, [meta, running, token, formValues]);

  const renderField = (param: ShareMeta['input_parameters'][0], idx: number) => {
    const dt = (param.dataType || 'string').toLowerCase();
    const label = param.name || `参数 ${idx + 1}`;
    const setVal = (v: unknown) => setFormValues((prev) => ({ ...prev, [param.name]: v }));

    return (
      <div key={idx} className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">{label}</Label>
          {param.required && <span className="text-xs text-red-500">*</span>}
        </div>
        {param.description && (
          <p className="text-xs text-muted-foreground">{param.description}</p>
        )}
        {dt === 'boolean' ? (
          <Switch checked={!!formValues[param.name]} onCheckedChange={setVal} />
        ) : dt === 'number' ? (
          <Input
            type="number"
            value={(formValues[param.name] as string) || ''}
            onChange={(e) => setVal(e.target.value)}
            className="h-8 text-sm"
          />
        ) : dt === 'object' || dt === 'array' ? (
          <Textarea
            value={(formValues[param.name] as string) || ''}
            onChange={(e) => setVal(e.target.value)}
            className="min-h-[80px] font-mono text-xs"
          />
        ) : (
          <Input
            value={(formValues[param.name] as string) || ''}
            onChange={(e) => setVal(e.target.value)}
            className="h-8 text-sm"
          />
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !meta) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
        <XCircle className="h-10 w-10 text-destructive" />
        <p className="text-sm text-muted-foreground">{error || t('share.notFound')}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted">
      <div className="mx-auto max-w-3xl px-6 py-8">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <GitBranch className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{meta.title}</h1>
            <p className="text-sm text-muted-foreground">
              {t('share.nodeCount', { count: meta.nodes.length })}
            </p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* 左侧：节点列表 */}
          <div className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">{t('share.flowNodes')}</h2>
            <div className="space-y-2">
              {meta.nodes.map((node, idx) => (
                <div key={node.id} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
                      {idx + 1}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {NODE_LABELS[node.type] || node.type}
                    </Badge>
                    <span className="truncate text-sm font-medium">{node.title}</span>
                  </div>
                  {node.description && (
                    <p className="mt-1 pl-8 text-xs text-muted-foreground">
                      {node.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 右侧：{t('share.testRun')} */}
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground">{t('share.testRun')}</h2>
            <div className="rounded-lg border border-border bg-card p-4">
              {meta.input_parameters.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">{t('share.noInputParams')}</p>
              ) : (
                <div className="space-y-3">
                  {meta.input_parameters.map((p, idx) => renderField(p, idx))}
                </div>
              )}
              <Button className="mt-4 w-full" onClick={handleRun} disabled={running}>
                {running ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    {t('share.run')}中...
                  </>
                ) : (
                  <>
                    <Play className="mr-1 h-4 w-4" />
                    {t('share.run')}
                  </>
                )}
              </Button>
            </div>

            {/* {t('share.results')} */}
            {(events.length > 0 || runError) && (
              <div className="space-y-2">
                <h2 className="text-sm font-medium text-muted-foreground">{t('share.results')}</h2>
                {runError && (
                  <div className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                    {runError}
                  </div>
                )}
                {events.map((event, idx) => (
                  <div key={idx} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{event.type}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatTime(event.timestamp)}
                      </span>
                    </div>
                    {event.data.nodeId && (
                      <div className="mt-1 flex items-center gap-2 text-xs">
                        {event.data.status === 'success' && (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                        )}
                        {event.data.status === 'failed' && (
                          <XCircle className="h-3.5 w-3.5 text-red-500" />
                        )}
                        {!event.data.status && (
                          <Clock className="h-3.5 w-3.5 text-gray-400" />
                        )}
                        <span className="text-muted-foreground">{event.data.nodeId}</span>
                      </div>
                    )}
                    {event.data.outputs &&
                      typeof event.data.outputs === 'object' &&
                      Object.keys(event.data.outputs).length > 0 && (
                        <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-[11px]">
                          {JSON.stringify(event.data.outputs, null, 2)}
                        </pre>
                      )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
