'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Boxes, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { NodeDefinition, NodeConfigField, NodePortDefinition } from '@/lib/tinyflow/node-definition';

// ===== 自定义节点库（Phase 5）=====
// 官方节点只读（内置）；自定义节点可创建/编辑/删除。
// 数据持久化到 node_definitions 表，运行时合并进 NodeRegistry。

const CATEGORIES = ['ai', 'integration', 'logic', 'data', 'custom'];
const CATEGORY_LABELS: Record<string, string> = {
  ai: 'AI', integration: '集成', logic: '逻辑', data: '数据', custom: '自定义',
};
const FIELD_TYPES = ['string', 'number', 'boolean', 'select', 'textarea', 'json', 'code'];

const EMPTY_FORM = {
  type: '',
  label: '',
  description: '',
  category: 'custom' as string,
  inputs: [] as NodePortDefinition[],
  outputs: [] as NodePortDefinition[],
  configSchema: [] as NodeConfigField[],
};

export default function CustomNodesPage() {
  const [nodes, setNodes] = useState<NodeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NodeDefinition | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/nodes/custom');
      const data = await res.json();
      if (Array.isArray(data?.nodes)) setNodes(data.nodes);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditId(null);
    setForm({ ...EMPTY_FORM });
    setEditorOpen(true);
  };

  const openEdit = (node: NodeDefinition) => {
    setEditId(node.type);
    setForm({
      type: node.type,
      label: node.label,
      description: node.description ?? '',
      category: node.category ?? 'custom',
      inputs: node.inputs ?? [],
      outputs: node.outputs ?? [],
      configSchema: node.configSchema ?? [],
    });
    setEditorOpen(true);
  };

  const handleSave = async () => {
    if (!form.type.trim() || !form.label.trim()) {
      toast.error('节点类型和名称不能为空');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        type: form.type.trim(),
        label: form.label.trim(),
        description: form.description,
        category: form.category,
        inputs: form.inputs,
        outputs: form.outputs,
        configSchema: form.configSchema,
      };
      const res = await fetch(
        editId ? `/api/nodes/custom/${encodeURIComponent(editId)}` : '/api/nodes/custom',
        {
          method: editId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || '保存失败');
        return;
      }
      toast.success(editId ? '节点已更新' : '节点已创建');
      setEditorOpen(false);
      load();
    } catch {
      toast.error('网络错误');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const res = await fetch(`/api/nodes/custom/${encodeURIComponent(deleteTarget.type)}`, { method: 'DELETE' });
    if (res.ok) toast.success('节点已删除');
    else toast.error('删除失败');
    setDeleteTarget(null);
    load();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Boxes className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">自定义节点库</h1>
            <p className="text-sm text-muted-foreground">
              创建自己的节点（metadata / configSchema / 输入输出），运行时自动注册进节点系统
            </p>
          </div>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          新建节点
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            加载中…
          </div>
        ) : nodes.length === 0 ? (
          <div className="rounded-lg border border-dashed py-16 text-center">
            <p className="text-sm text-muted-foreground">还没有自定义节点</p>
            <p className="mt-1 text-xs text-muted-foreground/60">点击「新建节点」创建第一个自定义节点</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {nodes.map((node) => (
              <div key={node.type} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">{node.label}</p>
                    <code className="text-[10px] text-muted-foreground">{node.type}</code>
                  </div>
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                    {CATEGORY_LABELS[node.category ?? 'custom'] ?? node.category}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-xs text-muted-foreground">
                  {node.description || '（无描述）'}
                </p>
                <div className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span>{node.inputs?.length ?? 0} 输入</span>
                  <span>·</span>
                  <span>{node.outputs?.length ?? 0} 输出</span>
                  <span>·</span>
                  <span>{node.configSchema?.length ?? 0} 配置项</span>
                </div>
                <div className="mt-3 flex gap-1">
                  <Button variant="outline" size="sm" className="h-7 flex-1 text-xs" onClick={() => openEdit(node)}>
                    <Pencil className="mr-1 h-3 w-3" />
                    编辑
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="删除" onClick={() => setDeleteTarget(node)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 创建/编辑对话框 */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="z-[1200] max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? '编辑自定义节点' : '新建自定义节点'}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">节点类型 *（字母开头，如 myNode）</Label>
                <Input
                  value={form.type}
                  disabled={!!editId}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                  placeholder="myNode"
                  className="font-mono text-xs"
                />
                <p className="text-[10px] text-muted-foreground">{editId ? '类型创建后不可修改（删除重建即可）' : '将作为画布 node.type 与执行器绑定键'}</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">分类</Label>
                <select
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">名称 *</Label>
              <Input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="我的节点" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">描述</Label>
              <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">输入输出端口（JSON）</Label>
              <Textarea
                value={JSON.stringify({ inputs: form.inputs, outputs: form.outputs }, null, 2)}
                onChange={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value) as { inputs?: NodePortDefinition[]; outputs?: NodePortDefinition[] };
                    setForm((f) => ({ ...f, inputs: parsed.inputs ?? [], outputs: parsed.outputs ?? [] }));
                  } catch {
                    // 非法 JSON 暂不更新（保存时校验）
                  }
                }}
                rows={5}
                className="font-mono text-[11px]"
                placeholder='{"inputs":[{"name":"input","label":"输入","dataType":"string"}],"outputs":[{"name":"output","label":"输出","dataType":"string"}]}'
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">配置表单 Schema（configSchema，JSON）</Label>
              <Textarea
                value={JSON.stringify(form.configSchema, null, 2)}
                onChange={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value) as NodeConfigField[];
                    setForm((f) => ({ ...f, configSchema: Array.isArray(parsed) ? parsed : [] }));
                  } catch {
                    // 非法 JSON 暂不更新
                  }
                }}
                rows={6}
                className="font-mono text-[11px]"
                placeholder='[{"name":"field","label":"字段","type":"string","required":true}]'
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        destructive
        title={`删除自定义节点「${deleteTarget?.label}」？`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
