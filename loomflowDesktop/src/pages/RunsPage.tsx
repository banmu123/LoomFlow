/**
 * RunsPage — Desktop 执行历史
 * 结构与 Web 端 /workflows/history 一致：
 * 展示本地 SQLite 中的 executions，并把 workflowId 映射为工作流标题。
 */

import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, CheckCircle2, XCircle, Clock, Ban, History, ExternalLink } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { useRepository } from '../app/repositories';
import type { ExecutionRecord } from '../app/repositories/workflow-repository';

const statusIcons: Record<string, typeof CheckCircle2> = {
  completed: CheckCircle2, failed: XCircle, cancelled: Ban, running: Loader2, pending: Clock, timeout: XCircle,
};
const statusColors: Record<string, string> = {
  completed: 'text-green-500', failed: 'text-red-500', cancelled: 'text-amber-500',
  running: 'text-blue-500 animate-spin', pending: 'text-muted-foreground', timeout: 'text-red-400',
};

function formatTime(iso: string) { try { return new Date(iso).toLocaleString(undefined, { hour12: false }); } catch { return iso; } }
function formatDuration(ms: number | null) { if (ms === null) return '-'; return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`; }

export default function RunsPage() {
  const repo = useRepository();
  const t = useT();
  const [runs, setRuns] = useState<ExecutionRecord[]>([]);
  // workflowId → 标题，避免表格里只显示一串截断的 UUID
  const [workflowTitles, setWorkflowTitles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      const [executions, workflows] = await Promise.all([
        repo.listExecutions(undefined, 100),
        repo.list(),
      ]);
      setRuns(executions);
      setWorkflowTitles(Object.fromEntries(workflows.map((w) => [w.id, w.title])));
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [repo]);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <History className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">{t('workflows.executionHistory')}</h1>
            <p className="text-sm text-muted-foreground">{t('workflows.viewRunResults')}</p>
          </div>
        </div>
        <button onClick={loadRuns} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
          {t('common.refresh')}
        </button>
      </div>
      <div className="flex-1 p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Clock className="mb-3 h-12 w-12 text-muted-foreground/30" /><p className="text-sm">{t('workflows.noExecutionRecords')}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">{t('workflows.status')}</th>
                  <th className="px-4 py-2.5 text-left font-medium">{t('history.workflow')}</th>
                  <th className="px-4 py-2.5 text-left font-medium">{t('history.duration')}</th>
                  <th className="px-4 py-2.5 text-left font-medium">{t('history.startedAt')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.map((run) => {
                  const Icon = statusIcons[run.status] ?? Clock;
                  const color = statusColors[run.status] ?? 'text-muted-foreground';
                  const title = workflowTitles[run.workflowId];
                  return (
                    <tr key={run.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2"><Icon className={`h-4 w-4 ${color}`} /><span>{t(`history.status${run.status.charAt(0).toUpperCase()}${run.status.slice(1)}`)}</span></div>
                      </td>
                      <td className="px-4 py-3">
                        {title ? (
                          <Link
                            to={`/workflows/editor/${run.workflowId}`}
                            className="inline-flex max-w-[240px] items-center gap-1.5 truncate font-medium text-foreground hover:text-primary hover:underline"
                            title={title}
                          >
                            <span className="truncate">{title}</span>
                            <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
                          </Link>
                        ) : (
                          <span className="font-mono text-xs text-muted-foreground">{run.workflowId.slice(0, 8)}...</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDuration(run.durationMs)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatTime(run.startedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
