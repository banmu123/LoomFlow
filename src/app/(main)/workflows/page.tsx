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
  Ban,
  Upload,
  Download,
  History,
  Link2,
  Clock,
} from 'lucide-react';
import { setPendingWorkflow } from '@/lib/pending-workflow';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
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
  api_key: string | null;
  api_quota: number;
  api_used: number;
  share_token: string | null;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
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
      setPendingWorkflow(wf.data);
      router.push('/workflows/editor');
    },
    [router],
  );

  const handleDelete = useCallback(
    async (wf: WorkflowRecord) => {
      if (!confirm(`确定要删除「${wf.title}」吗？此操作不可撤销。`)) return;
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
      }
    },
    [],
  );

  const handlePublish = useCallback(
    async (wf: WorkflowRecord, apiQuota?: number) => {
      setPublishingId(wf.id);
      try {
        const res = await fetch(`/api/workflow-history/${wf.id}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_quota: apiQuota ?? -1 }),
        });
        const data = await res.json();
        if (res.ok) {
          toast.success('工作流已发布，API Key 已生成');
          setPublishInfo(data);
          loadWorkflows();
        } else {
          toast.error(data?.error || '发布失败');
        }
      } catch {
        toast.error('发布失败');
      } finally {
        setPublishingId(null);
      }
    },
    [loadWorkflows],
  );

  const handleUnpublish = useCallback(
    async (wf: WorkflowRecord) => {
      if (!confirm(`确定要取消发布「${wf.title}」吗？API Key 将立即失效。`)) return;
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
      }
    },
    [loadWorkflows],
  );

  // 分享信息对话框
  const [shareInfo, setShareInfo] = useState<WorkflowRecord | null>(null);

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
      if (!confirm('确定取消分享吗？链接将立即失效。')) return;
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
  -H "Authorization: Bearer ${publishInfo.api_key}" \\
  -H "Content-Type: application/json" \\
  -d '{"inputs": {"query": "请输入"}}'`
    : '';

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

      {/* Content */}
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
                              onClick={() => handleUnpublish(wf)}
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
                            onClick={() => {
                              const input = prompt(
                                '设置 API 调用配额（-1 = 不限次数，其他数字 = 最多调用次数）',
                                '-1',
                              );
                              if (input === null) return;
                              const quota = parseInt(input, 10);
                              handlePublish(wf, isNaN(quota) ? -1 : quota);
                            }}
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
                          onClick={() => handleDelete(wf)}
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
              onClick={() => handleUnshare(shareInfo!)}
              disabled={publishingId === shareInfo?.id}
            >
              取消{t('workflows.share')}
            </Button>
            <Button onClick={() => setShareInfo(null)}>关闭</Button>
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
              <code className="block break-all rounded-md bg-muted p-2 text-xs">
                {publishInfo?.api_key ?? t('common.loading')}
              </code>
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
                · 调用配额：
                {publishInfo?.api_quota === -1
                  ? '不限次数'
                  : `${publishInfo?.api_used ?? 0} / ${publishInfo?.api_quota} 次`}
              </p>
              <p className="mt-1 text-amber-600">⚠️ API Key 只显示一次，请妥善保存；泄露可重新{t('workflows.publish')}轮换</p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleUnpublish(publishInfo!)}
              disabled={publishingId === publishInfo?.id}
            >
              {t('workflows.unpublish')}
            </Button>
            <Button onClick={() => setPublishInfo(null)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
