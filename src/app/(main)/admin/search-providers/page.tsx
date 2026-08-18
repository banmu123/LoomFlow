'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Trash2, Pencil, Loader2, PlugZap } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface SearchProvider {
  id: string;
  provider: string;
  capabilities: string[];
  label: string | null;
  base_url: string | null;
  config: Record<string, unknown> | null;
  enabled: boolean;
  created_at: string;
}

const CAPABILITIES = ['web', 'news', 'image', 'video'];
const PROVIDERS = ['tavily', 'exa', 'google'];

const EMPTY_FORM = {
  id: '',
  provider: 'tavily',
  capabilities: ['web'] as string[],
  label: '',
  base_url: '',
  api_key: '',
  cx: '',
  enabled: true,
};

const CAP_LABELS: Record<string, string> = {
  web: '网页',
  news: '新闻',
  image: '图片',
  video: '视频',
};

const PROVIDER_DESC: Record<string, string> = {
  tavily: 'Tavily：面向 AI 的搜索 API',
  exa: 'Exa：语义搜索 / 研究级搜索 API',
  google: 'Google Custom Search：需配置 cx（自定义搜索引擎 ID）',
};

export default function AdminSearchProvidersPage() {
  const t = useT();
  const [providers, setProviders] = useState<SearchProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const loadProviders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/search-providers');
      const data = await res.json();
      if (Array.isArray(data)) setProviders(data);
      else toast.error(data?.error || '加载失败');
    } catch {
      toast.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  const toggleCapability = (cap: string) => {
    setForm((f) => ({
      ...f,
      capabilities: f.capabilities.includes(cap)
        ? f.capabilities.filter((c) => c !== cap)
        : [...f.capabilities, cap],
    }));
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setDialogOpen(true);
  };

  const openEdit = (p: SearchProvider) => {
    setEditingId(p.id);
    setForm({
      id: p.id,
      provider: p.provider,
      capabilities: p.capabilities,
      label: p.label || '',
      base_url: p.base_url || '',
      api_key: '', // 编辑时 key 不回显（留空不修改）
      cx: String(p.config?.cx ?? ''),
      enabled: p.enabled,
    });
    setDialogOpen(true);
  };

  // 测试连接：已有配置用 id；新建/编辑时用表单当前值
  const testConnection = async (payload: { id: string } | Record<string, unknown>) => {
    const key = 'id' in payload ? payload.id : `${payload.provider}:${payload.apiKey}`;
    setTestingId(key as string);
    try {
      const res = await fetch('/api/search-providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data?.ok) {
        toast.success(data.message || '连接成功');
      } else {
        toast.error(data?.message || data?.error || '连接失败');
      }
    } catch {
      toast.error('连接失败：网络错误');
    } finally {
      setTestingId(null);
    }
  };

  const testForm = () => {
    const payload: Record<string, unknown> = {
      provider: form.provider,
      apiKey: form.api_key,
      baseURL: form.base_url,
      config: { cx: form.cx },
    };
    if (!form.api_key.trim() && editingId) {
      // 编辑时 key 未填 → 测试已保存的配置
      testConnection({ id: editingId });
      return;
    }
    testConnection(payload);
  };

  const handleSave = async () => {
    if (!form.id.trim()) {
      toast.error('配置名不能为空');
      return;
    }
    if (form.provider === 'google' && !form.cx.trim()) {
      toast.error('Google Custom Search 需要配置 cx（搜索引擎 ID）');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        editingId ? `/api/search-providers/${editingId}` : '/api/search-providers',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: form.id,
            provider: form.provider,
            label: form.label,
            base_url: form.base_url,
            api_key: form.api_key,
            config: { cx: form.cx },
            capabilities: form.capabilities,
            enabled: form.enabled,
          }),
        },
      );
      const data = await res.json();
      if (res.ok) {
        toast.success(editingId ? '搜索服务已更新' : '搜索服务已添加');
        setDialogOpen(false);
        loadProviders();
      } else {
        toast.error(data?.error || '保存失败');
      }
    } catch {
      toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (p: SearchProvider, enabled: boolean) => {
    try {
      const res = await fetch(`/api/search-providers/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        toast.success(enabled ? `已启用「${p.id}」` : `已禁用「${p.id}」`);
        loadProviders();
      } else {
        const data = await res.json();
        toast.error(data?.error || '操作失败');
      }
    } catch {
      toast.error('操作失败');
    }
  };

  // 统一确认弹窗（替代原生 confirm）
  const [deleteTarget, setDeleteTarget] = useState<SearchProvider | null>(null);

  const handleDelete = async (p: SearchProvider) => {
    try {
      const res = await fetch(`/api/search-providers/${p.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('已删除');
        loadProviders();
      } else {
        toast.error('删除失败');
      }
    } catch {
      toast.error('删除失败');
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">搜索配置</h2>
          <p className="text-sm text-muted-foreground">
            管理搜索服务（画布搜索节点下拉自动同步已启用的服务）
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadProviders} disabled={loading}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            添加搜索服务
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>配置名</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>能力</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                  加载中...
                </TableCell>
              </TableRow>
            )}
            {!loading && providers.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  暂无搜索服务配置
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              providers.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <span className="font-mono text-xs font-medium">{p.id}</span>
                    {p.label && (
                      <span className="ml-2 text-xs text-muted-foreground">{p.label}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{p.provider}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {p.capabilities.map((cap) => (
                        <Badge key={cap} variant="secondary" className="text-[10px]">
                          {CAP_LABELS[cap] || cap}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={p.enabled}
                        onCheckedChange={(v) => toggleEnabled(p, v)}
                      />
                      <span className="text-xs text-muted-foreground">
                        {p.enabled ? '已启用' : '已禁用'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => testConnection({ id: p.id })}
                        title="测试连接"
                        disabled={testingId !== null}
                      >
                        {testingId === p.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <PlugZap className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => openEdit(p)}
                        title="编辑"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 hover:text-destructive"
                        onClick={() => setDeleteTarget(p)}
                        title="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      <div className="mt-3 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <p className="mb-1 font-medium text-foreground">说明</p>
        <p>· 每个搜索服务可单独配置「API Key」（存在本系统数据库中，仅 admin 可管理）</p>
        <p>· 画布搜索节点通过下拉选择已启用的服务；启用/禁用即时生效（30 秒内同步）</p>
        <p>· 删除搜索服务后，引用它的搜索节点执行时会提示重新配置</p>
      </div>

      {/* 新建/编辑对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? '编辑搜索服务' : '添加搜索服务'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>配置名 *</Label>
              <Input
                value={form.id}
                onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
                placeholder="如 tavily-main"
                disabled={!!editingId}
                className="font-mono text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                画布搜索节点下拉将显示此名称
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Provider *</Label>
              <Select
                value={form.provider}
                onValueChange={(v) => setForm((f) => ({ ...f, provider: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">{PROVIDER_DESC[form.provider]}</p>
            </div>
            {form.provider === 'google' && (
              <div className="space-y-1.5">
                <Label>cx（自定义搜索引擎 ID）*</Label>
                <Input
                  value={form.cx}
                  onChange={(e) => setForm((f) => ({ ...f, cx: e.target.value }))}
                  placeholder="如 4c9f...:somelongid"
                  className="font-mono text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  Google Custom Search JSON API → 获取 cx（Programmable Search Engine）
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>API Key {editingId ? '（留空不修改）' : ''} *</Label>
              <Input
                type="password"
                value={form.api_key}
                onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                placeholder={editingId ? '已保存，留空表示不修改' : '如 tvly-xxx / exa_xxx / AIza...'}
                className="font-mono text-sm"
              />
              <p className="text-[11px] text-amber-600">
                ⚠️ Key 存储在本系统数据库中（仅 admin 可管理），请妥善保管
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Base URL</Label>
              <Input
                value={form.base_url}
                onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
                placeholder="留空用 provider 默认端点"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label>能力</Label>
              <div className="grid grid-cols-2 gap-2">
                {CAPABILITIES.map((cap) => (
                  <label key={cap} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={form.capabilities.includes(cap)}
                      onCheckedChange={() => toggleCapability(cap)}
                    />
                    {CAP_LABELS[cap] || cap}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>启用</Label>
                <p className="text-[11px] text-muted-foreground">
                  禁用后画布下拉不再显示
                </p>
              </div>
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={testForm}
              disabled={testingId !== null}
            >
              {testingId ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <PlugZap className="mr-1 h-4 w-4" />
              )}
              测试连接
            </Button>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 统一确认弹窗（替代原生 confirm） */}
      <ConfirmDialog
        open={!!deleteTarget}
        destructive
        title={deleteTarget ? `确定删除搜索服务「${deleteTarget.id}」吗？` : ''}
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
