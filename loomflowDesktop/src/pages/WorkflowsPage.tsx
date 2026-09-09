/**
 * WorkflowsPage — Desktop 工作流列表
 *
 * 结构与 Web 端一致：标题区域 + Tab（我的工作流/模板）+ 表格
 * 数据来自本地 SQLite repository。
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  GitBranch,
  Upload,
  Trash2,
  Loader2,
  CopyPlus,
  Download,
  Clock,
  Play,
} from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { useRepository } from '../app/repositories';
import type { WorkflowSummary } from '../app/repositories/workflow-repository';
import type { TinyflowData } from '@/lib/tinyflow/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ConfirmDialog';

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { hour12: false });
  } catch {
    return iso;
  }
}

export default function WorkflowsPage() {
  const navigate = useNavigate();
  const repo = useRepository();
  const t = useT();
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<WorkflowSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadWorkflows = useCallback(async () => {
    setLoading(true);
    try {
      const list = await repo.list();
      setWorkflows(list);
    } catch (err) {
      console.error('[WorkflowsPage] Load failed:', err);
      toast.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [repo, t]);

  useEffect(() => { loadWorkflows(); }, [loadWorkflows]);

  const handleOpen = useCallback((wf: WorkflowSummary) => {
    navigate(`/workflows/editor/${wf.id}`);
  }, [navigate]);

  const handleNew = useCallback(async () => {
    try {
      const data: TinyflowData = {
        nodes: [
          { id: 'start-1', type: 'startNode', position: { x: 100, y: 200 }, data: { title: 'Start', description: '', condition: '', loopEnable: false, loopIntervalMs: '', maxLoopCount: '', loopBreakCondition: '', retryEnable: false, retryIntervalMs: '', maxRetryCount: '', resetRetryCountAfterNormal: false } },
          { id: 'end-1', type: 'endNode', position: { x: 600, y: 200 }, data: { title: 'End', description: '', condition: '', loopEnable: false, loopIntervalMs: '', maxLoopCount: '', loopBreakCondition: '', retryEnable: false, retryIntervalMs: '', maxRetryCount: '', resetRetryCountAfterNormal: false } },
        ],
        edges: [{ id: 'edge-1', source: 'start-1', target: 'end-1' }],
        viewport: { x: 0, y: 0, zoom: 1 },
      };
      const wf = await repo.create({ title: t('workflows.untitled') || 'Untitled Workflow', data });
      toast.success(t('common.success'));
      navigate(`/workflows/editor/${wf.id}`);
    } catch (err) {
      toast.error(t('common.error'));
    }
  }, [repo, navigate, t]);

  const handleDuplicate = useCallback(async (wf: WorkflowSummary) => {
    try {
      await repo.duplicate(wf.id);
      toast.success(t('common.success'));
      loadWorkflows();
    } catch {
      toast.error(t('common.error'));
    }
  }, [repo, loadWorkflows, t]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await repo.delete(deleteTarget.id);
      toast.success(t('common.success'));
      setDeleteTarget(null);
      loadWorkflows();
    } catch {
      toast.error(t('common.error'));
    } finally {
      setDeleting(false);
    }
  }, [repo, deleteTarget, loadWorkflows, t]);

  const handleExport = useCallback(async (wf: WorkflowSummary) => {
    try {
      const full = await repo.get(wf.id);
      if (!full) return;
      const payload = { type: 'loomflow-workflow', version: 1, title: full.title, data: full.data };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${full.title || 'workflow'}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t('common.success'));
    } catch {
      toast.error(t('common.error'));
    }
  }, [repo, t]);

  const handleImport = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const data = (parsed?.data ?? parsed) as TinyflowData;
      if (!data?.nodes || !Array.isArray(data.nodes) || !data.edges) {
        toast.error(t('common.error'));
        return;
      }
      const title = parsed?.title || file.name.replace(/\.json$/i, '') || 'Imported';
      await repo.create({ title, data });
      toast.success(t('common.success'));
      loadWorkflows();
    } catch {
      toast.error(t('common.error'));
    }
  }, [repo, loadWorkflows, t]);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header — 与 Web 端一致 */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <GitBranch className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">{t('workflows.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('workflows.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">
            <Upload className="h-4 w-4" />
            {t('workflows.importWorkflow')}
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImport(file);
                e.target.value = '';
              }}
            />
          </label>
          <Button onClick={handleNew}>
            <Plus className="h-4 w-4" />
            {t('workflows.createWorkflow')}
          </Button>
        </div>
      </div>

      {/* 表格 — 与 Web 端一致 */}
      <div className="flex-1 p-6">
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">{t('workflows.name')}</th>
                <th className="px-4 py-2.5 text-left font-medium">{t('workflows.updatedAt')}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t('workflows.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                    {t('common.loading')}
                  </td>
                </tr>
              )}
              {!loading && workflows.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">
                    No workflows yet. Click "Create Workflow" to get started.
                  </td>
                </tr>
              )}
              {!loading && workflows.map((wf) => (
                <tr key={wf.id} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-foreground">{wf.title}</div>
                    {wf.description && (
                      <div className="mt-0.5 max-w-[200px] truncate text-xs text-muted-foreground">{wf.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      {formatTime(wf.updatedAt)}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-flex items-center gap-3">
                      <button onClick={() => handleOpen(wf)} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                        <Play className="h-3 w-3" />{t('workflows.open')}
                      </button>
                      <button onClick={() => handleExport(wf)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" title={t('workflows.exportWorkflow')}>
                        <Download className="h-3 w-3" />
                      </button>
                      <button onClick={() => handleDuplicate(wf)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
                        <CopyPlus className="h-3 w-3" />{t('workflows.duplicate')}
                      </button>
                      <button onClick={() => setDeleteTarget(wf)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3 w-3" />{t('common.delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        destructive
        title={deleteTarget ? t('workflows.deleteConfirm', { title: deleteTarget.title }) : ''}
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
