'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Loader2, KeyRound, Copy, Ban, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useT } from '@/lib/i18n';

interface ApiKeyStatus {
  api_key_expires_days: number | null;
  api_key_expires_at: string | null;
  created_at: string;
}

interface ApiWorkflow {
  id: string;
  title: string;
  published: boolean;
  updated_at: string;
}

const isExpired = (k: ApiKeyStatus): boolean =>
  !!k.api_key_expires_at && new Date(k.api_key_expires_at).getTime() < Date.now();

// Key 剩余天数（已过期返回 0）
const daysLeft = (expiresAt: string | null): number =>
  expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000)) : 0;

export default function WorkflowApiKeysPage() {
  const t = useT();
  // 全局 API Key 状态（不含明文，安全）
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus | null>(null);
  // 已发布的工作流
  const [workflows, setWorkflows] = useState<ApiWorkflow[]>([]);
  const [loading, setLoading] = useState(true);

  // 新 Key 弹窗（只显示一次）
  const [newKey, setNewKey] = useState<string | null>(null);

  // 配置弹窗
  const [configOpen, setConfigOpen] = useState(false);
  const [expiresInput, setExpiresInput] = useState('0');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [keyRes, wfRes] = await Promise.all([
        fetch('/api/api-key'),
        fetch('/api/workflow-history'),
      ]);
      const keyData = await keyRes.json();
      const wfData = await wfRes.json();
      if (keyRes.ok) setKeyStatus(keyData ?? null);
      // 仅展示已发布的工作流
      if (Array.isArray(wfData)) {
        setWorkflows(wfData.filter((w: ApiWorkflow) => w.published && w.id && w.title));
      }
    } catch {
      toast.error(t('apiKeys.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  // 生成全局 Key（Key 只显示一次）
  const handleGenerate = async () => {
    if (!confirm(t('apiKeys.generateConfirm'))) return;
    try {
      const res = await fetch('/api/api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok && data?.api_key) {
        setNewKey(data.api_key);
        toast.success(t('apiKeys.keyGenerated'));
        load();
      } else {
        toast.error(data?.error || t('apiKeys.generateFailed'));
      }
    } catch {
      toast.error(t('apiKeys.generateFailed'));
    }
  };

  // 重新生成全局 Key（旧 Key 立即失效，有效期配置保留）
  const handleRegenerate = async () => {
    if (!confirm(t('apiKeys.regenerateConfirm'))) return;
    try {
      const res = await fetch('/api/api-key/regenerate', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data?.api_key) {
        setNewKey(data.api_key);
        toast.success(t('apiKeys.keyGenerated'));
        load();
      } else {
        toast.error(data?.error || t('apiKeys.generateFailed'));
      }
    } catch {
      toast.error(t('apiKeys.generateFailed'));
    }
  };

  const openConfig = () => {
    if (!keyStatus) return;
    setExpiresInput(String(keyStatus.api_key_expires_days ?? 0));
    setConfigOpen(true);
  };

  const handleSaveConfig = async () => {
    const days = parseInt(expiresInput, 10);
    if (isNaN(days)) {
      toast.error(t('apiKeys.invalidNumber'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/api-key', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expires_days: days }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(t('apiKeys.configUpdated'));
        setConfigOpen(false);
        load();
      } else {
        toast.error(data?.error || t('apiKeys.updateFailed'));
      }
    } catch {
      toast.error(t('apiKeys.updateFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleUnpublish = async (wf: ApiWorkflow) => {
    if (!confirm(t('apiKeys.unpublishConfirm', { title: wf.title }))) return;
    try {
      const res = await fetch(`/api/workflow-history/${wf.id}/unpublish`, { method: 'POST' });
      if (res.ok) {
        toast.success(t('apiKeys.unpublished'));
        load();
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || t('apiKeys.opFailed'));
      }
    } catch {
      toast.error(t('apiKeys.opFailed'));
    }
  };

  const expired = keyStatus ? isExpired(keyStatus) : false;

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('apiKeys.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('apiKeys.subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </Button>
      </div>

      {/* 全局 Key 卡片 */}
      <div className="mb-6 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <KeyRound className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{t('apiKeys.keyStatus')}</span>
                {!keyStatus ? (
                  <Badge variant="outline">{t('apiKeys.keyNotGenerated')}</Badge>
                ) : expired ? (
                  <Badge variant="destructive">{t('apiKeys.expired')}</Badge>
                ) : (
                  <Badge variant="outline" className="text-green-600">
                    {t('apiKeys.valid')}
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {keyStatus
                  ? `${t('apiKeys.keyExpiry')}：${
                      keyStatus.api_key_expires_at
                        ? expired
                          ? new Date(keyStatus.api_key_expires_at).toLocaleString('zh-CN')
                          : t('apiKeys.daysLeft', { days: daysLeft(keyStatus.api_key_expires_at) })
                        : t('apiKeys.neverExpires')
                    }`
                  : t('apiKeys.keyNotGeneratedHint')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!keyStatus ? (
              <Button size="sm" onClick={handleGenerate}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('apiKeys.generate')}
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={openConfig}>
                  <Pencil className="mr-1 h-3.5 w-3.5" />
                  {t('apiKeys.config')}
                </Button>
                <Button variant="outline" size="sm" onClick={handleRegenerate}>
                  <KeyRound className="mr-1 h-3.5 w-3.5" />
                  {t('apiKeys.regenerate')}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 已发布工作流列表 */}
      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('apiKeys.workflow')}</TableHead>
              <TableHead>{t('apiKeys.status')}</TableHead>
              <TableHead>{t('apiKeys.updatedAt')}</TableHead>
              <TableHead className="text-right">{t('apiKeys.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                  {t('common.loading')}
                </TableCell>
              </TableRow>
            )}
            {!loading && workflows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  {t('apiKeys.noPublished')}
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              workflows.map((wf) => (
                <TableRow key={wf.id}>
                  <TableCell className="max-w-[220px] truncate font-medium">{wf.title}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-green-600">
                      {t('apiKeys.published')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(wf.updated_at).toLocaleString('zh-CN')}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs hover:text-destructive"
                      onClick={() => handleUnpublish(wf)}
                    >
                      <Ban className="mr-1 h-3 w-3" />
                      {t('apiKeys.unpublish')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      <div className="mt-3 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <p className="mb-1 font-medium text-foreground">{t('apiKeys.hintTitle')}</p>
        <p>{t('apiKeys.hintGlobal')}</p>
        <p>{t('apiKeys.hintKeyOnce')}</p>
        <p>{t('apiKeys.hintExpired')}</p>
        <p>{t('apiKeys.hintConfig')}</p>
      </div>

      {/* 新 Key 弹窗（只显示一次） */}
      <Dialog open={!!newKey} onOpenChange={(open) => !open && setNewKey(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('apiKeys.newKeyTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">{t('apiKeys.newKeyBody')}</p>
            <code className="block break-all rounded-md bg-muted p-2 text-xs">{newKey}</code>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (newKey) {
                  navigator.clipboard?.writeText(newKey);
                  toast.success(t('apiKeys.copied'));
                }
              }}
            >
              <Copy className="mr-1 h-3.5 w-3.5" />
              {t('common.copy')}
            </Button>
            <Button onClick={() => setNewKey(null)}>{t('common.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 配置弹窗 */}
      <Dialog open={configOpen} onOpenChange={(open) => !open && setConfigOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('apiKeys.configTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t('apiKeys.expiryLabel')}</Label>
              <Input value={expiresInput} onChange={(e) => setExpiresInput(e.target.value)} type="number" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSaveConfig} disabled={saving}>
              {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
