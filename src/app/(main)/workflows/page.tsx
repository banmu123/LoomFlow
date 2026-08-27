'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Plus,
  GitBranch,
  Play,
  Trash2,
  Loader2,
  Share2,
  Copy,
  CopyPlus,
  Ban,
  Upload,
  Download,
  History,
  Link2,
  Clock,
  FileDown,
} from 'lucide-react';
import { setPendingWorkflow } from '@/lib/pending-workflow';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatVersion } from '@/lib/version';
import {
  WORKFLOW_TEMPLATES,
  TEMPLATE_CATEGORIES,
  normalizeWorkflowModels,
  type WorkflowTemplate,
} from '@/lib/workflow-templates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface WorkflowRecord {
  id: string;
  title: string;
  description: string | null;
  data: {
    nodes?: Array<{ id: string; type?: string }>;
    edges?: unknown[];
  };
  created_at: string;
  updated_at: string;
  published: boolean;
  share_token: string | null;
  // 仅发布响应中返回（首次生成时显示一次），列表接口不返回
  api_key?: string | null;
}

interface VersionItem {
  version: number;
  title: string;
  description: string | null;
  created_at: string;
  is_current: boolean;
  published: boolean;
  published_version: number | null;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { hour12: false });
}

export default function WorkflowsPage() {
  const router = useRouter();
  const t = useT();
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);

  // 发布信息对话框
  const [publishInfo, setPublishInfo] = useState<WorkflowRecord | null>(null);

  const loadWorkflows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/workflow-history');
      const data = await res.json();
      if (Array.isArray(data)) setWorkflows(data);
    } catch {
      toast.error('加载工作流列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  const handleOpen = useCallback(
    (wf: WorkflowRecord) => {
      // 携带工作流 id：画布后续保存=更新当前记录并记录版本（不新增列表条目）
      setPendingWorkflow(wf.data, wf.id);
      router.push('/workflows/editor');
    },
    [router],
  );

  const handleDelete = useCallback(
    async (wf: WorkflowRecord) => {
      setDeletingId(wf.id);
      try {
        const res = await fetch(`/api/workflow-history/${wf.id}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          setWorkflows((prev) => prev.filter((w) => w.id !== wf.id));
          toast.success(t('common.success') + '，已删除');
        } else {
          toast.error('删除失败');
        }
      } catch {
        toast.error('删除失败');
      } finally {
        setDeletingId(null);
        setConfirmState(null);
      }
    },
    [],
  );

  // 发布版本选择对话框：发布 = 选择版本（默认当前版本）
  const [publishDialog, setPublishDialog] = useState<{
    wf: WorkflowRecord;
    versions: VersionItem[];
    selected: number | null;
  } | null>(null);

  const openPublishDialog = useCallback(async (wf: WorkflowRecord) => {
    try {
      const res = await fetch(`/api/workflow-history/${wf.id}/versions`);
      const versions = await res.json();
      if (!Array.isArray(versions) || versions.length === 0) {
        toast.error('该工作流暂无版本记录，请先在画布保存');
        return;
      }
      // 默认选中当前版本（is_current），无则最新
      const current = versions.find((v: VersionItem) => v.is_current) ?? versions[0];
      setPublishDialog({ wf, versions, selected: current?.version ?? null });
    } catch {
      toast.error('加载版本列表失败');
    }
  }, []);

  const handlePublish = useCallback(async () => {
    if (!publishDialog || publishDialog.selected == null) return;
    const { wf, selected } = publishDialog;
    setPublishingId(wf.id);
    try {
      const res = await fetch(`/api/workflow-history/${wf.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: selected }),
      });
      const data = await res.json();
      if (res.ok) {
        // 首次发布自动生成全局 API Key，仅在本次响应显示一次
        toast.success(
          data?.api_key
            ? `已发布版本 v${formatVersion(selected)}，全局 API Key 已生成（仅显示一次）`
            : `已发布版本 v${formatVersion(selected)}`,
        );
        setPublishInfo(data);
        setPublishDialog(null);
        loadWorkflows();
      } else {
        toast.error(data?.error || '发布失败');
      }
    } catch {
      toast.error('发布失败');
    } finally {
      setPublishingId(null);
    }
  }, [publishDialog, loadWorkflows]);

  const handleUnpublish = useCallback(
    async (wf: WorkflowRecord) => {
      setPublishingId(wf.id);
      try {
        const res = await fetch(`/api/workflow-history/${wf.id}/unpublish`, {
          method: 'POST',
        });
        const data = await res.json();
        if (res.ok) {
          toast.success('已取消发布');
          setPublishInfo(null);
          loadWorkflows();
        } else {
          toast.error(data?.error || '操作失败');
        }
      } catch {
        toast.error('操作失败');
      } finally {
        setPublishingId(null);
        setConfirmState(null);
      }
    },
    [loadWorkflows],
  );

  // 分享信息对话框
  const [shareInfo, setShareInfo] = useState<WorkflowRecord | null>(null);

  // 统一确认弹窗（替代原生 confirm）
  const [confirmState, setConfirmState] = useState<{
    action: 'delete' | 'unpublish' | 'unshare';
    wf: WorkflowRecord | null;
  } | null>(null);
  const confirmTitle = confirmState
    ? confirmState.action === 'delete'
      ? t('workflows.deleteConfirm', { title: confirmState.wf?.title ?? '' })
      : confirmState.action === 'unpublish'
        ? `确定要取消发布「${confirmState.wf?.title}」吗？API Key 将立即失效。`
        : t('workflows.unshareConfirm')
    : '';

  const handleShare = useCallback(
    async (wf: WorkflowRecord) => {
      setPublishingId(wf.id);
      try {
        const res = await fetch(`/api/workflow-history/${wf.id}/share`, {
          method: 'POST',
        });
        const data = await res.json();
        if (res.ok) {
          toast.success('分享链接已生成');
          setShareInfo({ ...wf, ...data });
          loadWorkflows();
        } else {
          toast.error(data?.error || '生成分享链接失败');
        }
      } catch {
        toast.error('生成分享链接失败');
      } finally {
        setPublishingId(null);
      }
    },
    [loadWorkflows],
  );

  const handleUnshare = useCallback(
    async (wf: WorkflowRecord) => {
      setPublishingId(wf.id);
      try {
        const res = await fetch(`/api/workflow-history/${wf.id}/share`, {
          method: 'DELETE',
        });
        if (res.ok) {
          toast.success('已取消分享');
          setShareInfo(null);
          loadWorkflows();
        } else {
          toast.error('操作失败');
        }
      } catch {
        toast.error('操作失败');
      } finally {
        setPublishingId(null);
        setConfirmState(null);
      }
    },
    [loadWorkflows],
  );

  const shareLink = shareInfo?.share_token
    ? `${window.location.origin}/share/${shareInfo.share_token}`
    : '';

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label}已复制`);
    } catch {
      toast.error('复制失败');
    }
  };

  // 导出工作流为 JSON 文件
  const handleExport = useCallback((wf: WorkflowRecord) => {
    const payload = {
      type: 'forgeflow-workflow',
      version: 1,
      title: wf.title,
      data: wf.data,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${wf.title || '工作流'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('已导出工作流文件');
  }, []);

  // 导入工作流 JSON 文件
  const handleImport = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const data = parsed?.data ?? parsed;
        if (!data?.nodes || !Array.isArray(data.nodes) || !data.edges) {
          toast.error('文件格式不正确：缺少 nodes/edges');
          return;
        }
        const title = parsed?.title || file.name.replace(/\.json$/i, '') || '导入的工作流';
        const res = await fetch('/api/workflow-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, data }),
        });
        const result = await res.json();
        if (res.ok) {
          toast.success(`「${result.title}」导入成功`);
          loadWorkflows();
        } else {
          toast.error(result?.error || '导入失败');
        }
      } catch {
        toast.error('文件解析失败，请确认是有效的 JSON');
      }
    },
    [loadWorkflows],
  );

  const curlExample = publishInfo
    ? `curl -X POST ${window.location.origin}/api/publish/${publishInfo.id}/execute \\
  -H "Authorization: Bearer ${publishInfo.api_key ?? '<API Key>'}" \\
  -H "Content-Type: application/json" \\
  -d '{"inputs": {"query": "请输入"}}'`
    : '';

  // 导出 API 文档（Markdown，基于发布工作流的输入参数与输出定义）
  const handleExportApiDoc = useCallback(() => {
    if (!publishInfo) return;
    const nodes = (publishInfo.data?.nodes ?? []) as Array<{
      type?: string;
      data?: Record<string, unknown>;
    }>;
    const startNode = nodes.find((n) => n.type === 'startNode');
    const endNode = nodes.find((n) => n.type === 'endNode');
    const params = startNode?.data?.parameters as
      | Array<{ name?: string; dataType?: string; required?: boolean; defaultValue?: unknown }>
      | undefined;
    const outputs = endNode?.data?.outputDefs as
      | Array<{ name?: string; dataType?: string }>
      | undefined;

    const lines: string[] = [];
    lines.push(`# ${publishInfo.title} — API 文档`);
    lines.push('');
    lines.push('## 接口');
    lines.push('');
    lines.push(`- 执行：\`POST ${window.location.origin}/api/publish/${publishInfo.id}/execute\``);
    lines.push(`- 查询：\`GET ${window.location.origin}/api/publish/${publishInfo.id}/status/[flowId]\``);
    lines.push(`- 确认：\`POST ${window.location.origin}/api/publish/${publishInfo.id}/confirm/[flowId]\``);
    lines.push('');
    lines.push('## 鉴权');
    lines.push('');
    lines.push('所有请求需带请求头：`Authorization: Bearer <API Key>`（Key 在「API 管理」页管理）');
    lines.push('');
    lines.push('## 调用示例');
    lines.push('');
    lines.push('```bash');
    lines.push(curlExample.replaceAll('\\\n', '\n'));
    lines.push('```');
    lines.push('');
    lines.push('## 输入参数');
    lines.push('');
    lines.push('| 参数 | 类型 | 必填 | 默认值 |');
    lines.push('|------|------|------|--------|');
    if (params && params.length > 0) {
      for (const p of params) {
        lines.push(
          `| ${p.name || '-'} | ${p.dataType || 'String'} | ${p.required ? '✅' : '—'} | ${String(p.defaultValue ?? '') || '—'} |`,
        );
      }
    } else {
      lines.push('| （无输入参数） | | | |');
    }
    lines.push('');
    lines.push('## 输出');
    lines.push('');
    if (outputs && outputs.length > 0) {
      for (const o of outputs) {
        lines.push(`- \`outputs.${o.name || 'result'}\`：${o.dataType || 'String'}`);
      }
    } else {
      lines.push('- `outputs.result`：最终输出');
    }
    lines.push('');

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${publishInfo.title || '工作流'}-API文档.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t('workflows.exportApiDocDone'));
  }, [publishInfo, curlExample, t]);

  // 复制工作流（新建副本）
  const handleDuplicate = useCallback(
    async (wf: WorkflowRecord) => {
      setPublishingId(wf.id);
      try {
        const res = await fetch('/api/workflow-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `${wf.title}（副本）`,
            description: wf.description,
            data: wf.data,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          toast.success(`已创建副本「${data.title}」`);
          loadWorkflows();
        } else {
          toast.error(data?.error || '复制失败');
        }
      } catch {
        toast.error('复制失败');
      } finally {
        setPublishingId(null);
      }
    },
    [loadWorkflows],
  );

  // 页面 Tab：我的工作流 / 工作流模板
  const [activeTab, setActiveTab] = useState<'list' | 'templates'>('list');
  const [templateCategory, setTemplateCategory] = useState('all');

  // 使用模板：加载到画布（模板模型 id 自动替换为用户配置的模型）
  const handleUseTemplate = useCallback(
    async (tpl: WorkflowTemplate) => {
      try {
        await normalizeWorkflowModels(tpl.data);
      } catch {
        // 规范化失败不阻断加载
      }
      setPendingWorkflow(tpl.data);
      toast.success(`已加载模板「${tpl.title}」到画布，修改后点击保存即可创建`);
      router.push('/workflows/editor');
    },
    [router],
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
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
          <Link
            href="/workflows/history"
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <History className="h-4 w-4" />
            {t('workflows.executionHistory')}
          </Link>
          <Link
            href="/workflows/schedules"
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <Clock className="h-4 w-4" />
            {t('workflows.scheduleTasks')}
          </Link>
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
          <Link
            href="/workflows/editor"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            {t('workflows.createWorkflow')}
          </Link>
        </div>
      </div>

      {/* Tab 切换：我的工作流 / 工作流模板 */}
      <div className="flex items-center gap-1 border-b border-border px-6 pt-3">
        <button
          onClick={() => setActiveTab('list')}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === 'list'
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          {t('workflows.myWorkflows')}
        </button>
        <button
          onClick={() => setActiveTab('templates')}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === 'templates'
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          {t('workflows.templates')}
        </button>
      </div>

      {/* Content */}
      {activeTab === 'templates' ? (
        /* 工作流模板：新用户引导 */
        <div className="flex-1 overflow-y-auto p-6">
          <p className="mb-4 text-sm text-muted-foreground">{t('workflows.templatesHint')}</p>
          <div className="mb-4 flex flex-wrap gap-1.5">
            <button
              onClick={() => setTemplateCategory('all')}
              className={
                templateCategory === 'all'
                  ? 'rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs text-primary'
                  : 'rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground hover:border-primary/40'
              }
            >
              {t('templates.all')}
            </button>
            {TEMPLATE_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setTemplateCategory(cat.id)}
                className={
                  templateCategory === cat.id
                    ? 'rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs text-primary'
                    : 'rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground hover:border-primary/40'
                }
              >
                {cat.label}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {WORKFLOW_TEMPLATES.filter((tpl) => templateCategory === 'all' || tpl.category === templateCategory).map((tpl) => (
              <div
                key={tpl.id}
                className="flex flex-col gap-3 rounded-lg border border-border p-4 transition-colors hover:border-primary/50"
              >
                <div className="flex items-start justify-between">
                  <span className="text-2xl">{tpl.emoji}</span>
                  <div className="flex gap-1">
                    {tpl.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="font-medium text-foreground">{tpl.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{tpl.description}</p>
                </div>
                <Button size="sm" className="w-full" onClick={() => handleUseTemplate(tpl)}>
                  {t('workflows.useTemplate')}
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : (
      <div className="flex-1 p-6">
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">{t('workflows.name')}</th>
                <th className="px-4 py-2.5 text-left font-medium">{t('workflows.nodes')}</th>
                <th className="px-4 py-2.5 text-left font-medium">{t('workflows.status')}</th>
                <th className="px-4 py-2.5 text-left font-medium">{t('workflows.updatedAt')}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t('workflows.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                    {t('common.loading')}
                  </td>
                </tr>
              )}
              {!loading && workflows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    暂无保存的工作流，去画布生成后点击「保存到历史」即可显示在这里
                  </td>
                </tr>
              )}
              {!loading &&
                workflows.map((wf) => (
                  <tr key={wf.id} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-foreground">{wf.title}</div>
                      {wf.description && (
                        <div className="mt-0.5 max-w-[200px] truncate text-xs text-muted-foreground">
                          {wf.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {wf.data?.nodes?.length ?? 0}
                    </td>
                    <td className="px-4 py-2.5">
                      {wf.published ? (
                        <Badge variant="outline" className="text-green-600">
                          <Share2 className="mr-1 h-3 w-3" />
                          {t('workflows.published')}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">{t('workflows.unpublished')}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {formatTime(wf.updated_at)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex items-center gap-3">
                        <button
                          onClick={() => handleOpen(wf)}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <Play className="h-3 w-3" />
                          {t('workflows.open')}
                        </button>
                        <button
                          onClick={() => handleExport(wf)}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          title={t('workflows.exportWorkflow')}
                        >
                          <Download className="h-3 w-3" />
                          {t('workflows.exportWorkflow')}
                        </button>
                        {wf.share_token ? (
                          <button
                            onClick={() => setShareInfo(wf)}
                            className="inline-flex items-center gap-1 text-xs text-green-600 hover:underline"
                            title="查看{t('workflows.share')}链接"
                          >
                            <Link2 className="h-3 w-3" />
                            已{t('workflows.share')}
                          </button>
                        ) : (
                          <button
                            onClick={() => handleShare(wf)}
                            disabled={publishingId === wf.id}
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            {publishingId === wf.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Link2 className="h-3 w-3" />
                            )}
                            {t('workflows.share')}
                          </button>
                        )}
                        {wf.published ? (
                          <>
                            <button
                              onClick={() => setPublishInfo(wf)}
                              className="inline-flex items-center gap-1 text-xs text-green-600 hover:underline"
                            >
                              <Share2 className="h-3 w-3" />
                              {t('workflows.apiInfo')}
                            </button>
                            <button
                              onClick={() => setConfirmState({ action: 'unpublish', wf })}
                              disabled={publishingId === wf.id}
                              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-amber-600"
                            >
                              {publishingId === wf.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Ban className="h-3 w-3" />
                              )}
                              {t('workflows.unpublish')}
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => openPublishDialog(wf)}
                            disabled={publishingId === wf.id}
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            {publishingId === wf.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Share2 className="h-3 w-3" />
                            )}
                            {t('workflows.publish')}
                          </button>
                        )}
                        <button
                          onClick={() => handleDuplicate(wf)}
                          disabled={publishingId === wf.id}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                        >
                          <CopyPlus className="h-3 w-3" />
                          {t('workflows.duplicate')}
                        </button>
                        <button
                          onClick={() => setConfirmState({ action: 'delete', wf })}
                          disabled={deletingId === wf.id}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
                        >
                          {deletingId === wf.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                          {t('common.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* {t('workflows.share')}链接对话框 */}
      <Dialog open={!!shareInfo} onOpenChange={(open) => !open && setShareInfo(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('workflows.share')}工作流</DialogTitle>
            <DialogDescription>
              「{shareInfo?.title}」已生成公开{t('workflows.share')}链接，无需登录即可查看和试运行
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t('workflows.share')}链接</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => copyText(shareLink, t('workflows.sharedLink'))}
              >
                <Copy className="mr-1 h-3 w-3" />
                {t('common.copy')}
              </Button>
            </div>
            <code className="block break-all rounded-md bg-muted p-2 text-xs">
              {shareLink}
            </code>
            <p className="text-xs text-muted-foreground">
              对方{t('workflows.open')}链接可查看流程节点、填写输入并试运行（会消耗模型额度）。
            </p>
            <p className="text-xs text-amber-600">
              ⚠️ {t('workflows.shareWarning')}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmState({ action: 'unshare', wf: shareInfo })}
              disabled={publishingId === shareInfo?.id}
            >
              取消{t('workflows.share')}
            </Button>
            <Button onClick={() => setShareInfo(null)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 发布版本选择对话框 */}
      <Dialog
        open={!!publishDialog}
        onOpenChange={(open) => !open && setPublishDialog(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('workflows.publishVersion')}</DialogTitle>
            <DialogDescription>
              {t('workflows.publishVersionDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[320px] space-y-2 overflow-y-auto py-2">
            {publishDialog?.versions.map((v) => {
              const isSelected = publishDialog.selected === v.version;
              return (
                <div
                  key={v.version}
                  onClick={() =>
                    setPublishDialog((d) => (d ? { ...d, selected: v.version } : d))
                  }
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border p-3 text-sm transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-medium">v{formatVersion(v.version)}</span>
                    {v.is_current && (
                      <Badge variant="outline" className="shrink-0 text-green-600">
                        {t('workflows.currentVersion')}
                      </Badge>
                    )}
                    <span className="truncate text-xs text-muted-foreground">
                      {v.title}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatTime(v.created_at)}
                  </span>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishDialog(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handlePublish} disabled={publishingId !== null}>
              {publishingId !== null && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {publishDialog?.selected != null
                ? `${t('workflows.publish')} v${formatVersion(publishDialog.selected)}`
                : t('workflows.publish')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* {t('workflows.apiInfo')}对话框 */}
      <Dialog open={!!publishInfo} onOpenChange={(open) => !open && setPublishInfo(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>工作流 API</DialogTitle>
            <DialogDescription>
              「{publishInfo?.title}」{t('workflows.published')}，外部系统可通过以下接口调用
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* API Key */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">API Key</span>
                {publishInfo?.api_key && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => copyText(publishInfo.api_key!, 'API Key')}
                  >
                    <Copy className="mr-1 h-3 w-3" />
                    {t('common.copy')}
                  </Button>
                )}
              </div>
              {publishInfo?.api_key ? (
                <code className="block break-all rounded-md bg-muted p-2 text-xs">
                  {publishInfo.api_key}
                </code>
              ) : (
                <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
                  {t('publish.keyHiddenHint')}{' '}
                  <Link href="/workflows/api-keys" className="text-primary underline">
                    {t('apiKeys.title')}
                  </Link>
                </p>
              )}
            </div>

            {/* 调用示例 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">调用示例（curl）</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => copyText(curlExample, '调用示例')}
                >
                  <Copy className="mr-1 h-3 w-3" />
                  {t('common.copy')}
                </Button>
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs">
                {curlExample}
              </pre>
            </div>

            {/* 参数说明 */}
            <div className="rounded-md border border-border p-3 text-xs text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">接口说明</p>
              <p>· 执行：POST /api/publish/{publishInfo?.id}/execute，body 传 {`{ "inputs": { ... } }`}</p>
              <p>· 查询：GET /api/publish/{publishInfo?.id}/status/[flowId]</p>
              <p>· 确认：POST /api/publish/{publishInfo?.id}/confirm/[flowId]</p>
              <p>· 所有请求需带请求头：Authorization: Bearer &lt;API Key&gt;</p>
              <p>
                · 全局 API Key（有效期配置）：
                <Link href="/workflows/api-keys" className="text-primary hover:underline">
                  {t('apiKeys.title')}
                </Link>
              </p>
              <p className="mt-1 text-amber-600">⚠️ API Key 只显示一次，请妥善保存；泄露可在「API 管理」重新生成</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleExportApiDoc}>
              <FileDown className="mr-1 h-4 w-4" />
              {t('workflows.exportApiDoc')}
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirmState({ action: 'unpublish', wf: publishInfo })}
              disabled={publishingId === publishInfo?.id}
            >
              {t('workflows.unpublish')}
            </Button>
            <Button onClick={() => setPublishInfo(null)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 统一确认弹窗（替代原生 confirm） */}
      <ConfirmDialog
        open={!!confirmState}
        destructive={confirmState?.action !== 'unshare'}
        title={confirmTitle}
        loading={!!deletingId || !!publishingId}
        onConfirm={() => {
          if (!confirmState?.wf) return;
          if (confirmState.action === 'delete') handleDelete(confirmState.wf);
          else if (confirmState.action === 'unpublish') handleUnpublish(confirmState.wf);
          else if (confirmState.action === 'unshare') handleUnshare(confirmState.wf);
        }}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
}
