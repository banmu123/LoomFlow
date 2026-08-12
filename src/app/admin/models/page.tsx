'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Trash2, Pencil, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

interface AiModel {
  id: string;
  provider: string;
  capabilities: string[];
  label: string | null;
  created_at: string;
}

const CAPABILITIES = ['text', 'vision', 'audio', 'image', 'tool'];
const PROVIDERS = ['deepseek', 'ark', 'openai-compatible', 'custom'];

const EMPTY_FORM = {
  id: '',
  provider: 'deepseek',
  capabilities: ['text'] as string[],
  label: '',
};

const CAP_LABELS: Record<string, string> = {
  text: '文本',
  vision: '视觉',
  audio: '音频',
  image: '图像生成',
  tool: '工具调用',
};

export default function AdminModelsPage() {
  const t = useT();
  const [models, setModels] = useState<AiModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const loadModels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/models');
      const data = await res.json();
      if (Array.isArray(data)) setModels(data);
      else toast.error(data?.error || '加载失败');
    } catch {
      toast.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

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

  const openEdit = (m: AiModel) => {
    setEditingId(m.id);
    setForm({
      id: m.id,
      provider: m.provider,
      capabilities: m.capabilities,
      label: m.label || '',
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.id.trim() || !form.provider) {
      toast.error('模型 ID 和 provider 不能为空');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        editingId ? `/api/ai/models/${editingId}` : '/api/ai/models',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        },
      );
      const data = await res.json();
      if (res.ok) {
        toast.success(editingId ? '模型已更新' : '模型已添加');
        setDialogOpen(false);
        loadModels();
      } else {
        toast.error(data?.error || '保存失败');
      }
    } catch {
      toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (m: AiModel) => {
    if (!confirm(`确定删除模型「${m.id}」吗？`)) return;
    try {
      const res = await fetch(`/api/ai/models/${m.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('已删除');
        loadModels();
      } else {
        toast.error('删除失败');
      }
    } catch {
      toast.error('删除失败');
    }
  };

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">模型配置</h2>
          <p className="text-sm text-muted-foreground">
            管理 AI 模型（画布 LLM 节点与对话模型列表自动同步）
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadModels} disabled={loading}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            添加模型
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>模型 ID</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>能力</TableHead>
              <TableHead>显示名</TableHead>
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
            {!loading && models.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  暂无模型配置
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              models.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono text-xs font-medium">{m.id}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{m.provider}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {m.capabilities.map((cap) => (
                        <Badge key={cap} variant="secondary" className="text-[10px]">
                          {CAP_LABELS[cap] || cap}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{m.label || '-'}</TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-2">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(m)} title="编辑">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 hover:text-destructive"
                        onClick={() => handleDelete(m)}
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
        <p>· Provider 的 API Key / 端点地址在服务器环境变量中配置（DEEPSEEK_API_KEY / ARK_API_KEY / ARK_BASE_URL），不会存储在数据库</p>
        <p>· 添加带「视觉」能力的模型后，对话图片上传与画布多模态节点自动启用</p>
        <p>· 删除或修改模型后，画布与对话列表即时生效（30 秒内同步）</p>
      </div>

      {/* 新建/编辑对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? '编辑模型' : '添加模型'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>模型 ID *</Label>
              <Input
                value={form.id}
                onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
                placeholder="如 deepseek-v4-flash / qwen-vl-max"
                disabled={!!editingId}
                className="font-mono text-sm"
              />
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
            <div className="space-y-1.5">
              <Label>显示名</Label>
              <Input
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="如 DeepSeek Flash"
              />
            </div>
          </div>
          <DialogFooter>
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
    </div>
  );
}
