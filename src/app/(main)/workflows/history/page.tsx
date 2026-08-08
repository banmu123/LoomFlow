'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, Loader2, History } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface FlowRun {
  id: string;
  workflow_id: string | null;
  source: string;
  status: string;
  inputs: Record<string, unknown> | null;
  outputs: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  running: '执行中',
  completed: '成功',
  paused: '已暂停',
  failed: '失败',
};

function statusVariant(
  status: string,
): 'default' | 'destructive' | 'secondary' | 'outline' {
  if (status === 'completed') return 'default';
  if (status === 'failed') return 'destructive';
  return 'secondary';
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

export default function WorkflowHistoryPage() {
  const t = useT();
  const [runs, setRuns] = useState<FlowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<FlowRun | null>(null);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/flow-runs');
      const data = await res.json();
      if (Array.isArray(data)) setRuns(data);
      else toast.error(data?.error || '加载失败');
    } catch {
      toast.error(t('errors.networkError'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => history.back()}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t('common.back')}
          </Button>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <History className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">{t('history.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('history.subtitle')}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={loadRuns} disabled={loading}>
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 p-6">
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.time')}</TableHead>
                <TableHead>{t('history.source')}</TableHead>
                <TableHead>{t('workflows.status')}</TableHead>
                <TableHead>{t('history.inputs')}</TableHead>
                <TableHead className="text-right">{t('workflows.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                    {t('common.loading')}
                  </TableCell>
                </TableRow>
              )}
              {!loading && runs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    {t('history.noRecords')}
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                runs.map((run) => (
                  <TableRow key={run.id} className="hover:bg-muted/30">
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatTime(run.created_at)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {run.source === 'api' ? t('history.apiCall') : t('history.canvasRun')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(run.status)}>
                        {STATUS_LABELS[run.status] || run.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <code className="block truncate rounded bg-muted px-1.5 py-0.5 text-[11px]">
                        {JSON.stringify(run.inputs || {})}
                      </code>
                    </TableCell>
                    <TableCell className="text-right">
                      <button
                        onClick={() => setDetail(run)}
                        className="text-xs text-primary hover:underline"
                      >
                        {t('history.viewDetail')}
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* 详情对话框 */}
      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t('history.detail')}（{detail ? formatTime(detail.created_at) : ''}）
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2">
              <Badge variant={detail ? statusVariant(detail.status) : 'secondary'}>
                {detail ? STATUS_LABELS[detail.status] || detail.status : ''}
              </Badge>
              <Badge variant="outline">
                {detail?.source === 'api' ? t('history.apiCall') : t('history.canvasRun')}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {t('history.runId')}：{detail?.id}
              </span>
            </div>

            {detail?.error && (
              <div className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                {detail.error}
              </div>
            )}

            <div className="space-y-1.5">
              <h4 className="text-sm font-medium">{t('history.inputs')}</h4>
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs">
                {JSON.stringify(detail?.inputs ?? {}, null, 2)}
              </pre>
            </div>

            <div className="space-y-1.5">
              <h4 className="text-sm font-medium">{t('history.outputs')}</h4>
              <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs">
                {detail?.outputs
                  ? JSON.stringify(detail.outputs, null, 2)
                  : detail?.status === 'completed'
                    ? t('history.noOutput')
                    : t('history.notFinished')}
              </pre>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
