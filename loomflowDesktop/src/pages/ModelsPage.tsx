/**
 * ModelsPage — 模型配置管理
 *
 * 与 Web 端 Admin Models 对齐：CRUD、provider 选择、能力标签、启用/禁用。
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Settings2,
  Plus,
  Trash2,
  Loader2,
  Pencil,
  Cpu,
  Eye,
  Wrench,
  Check,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { useRepository } from '../app/repositories';
import type { AIModelRecord, CreateAIModelInput } from '../app/repositories/workflow-repository';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ConfirmDialog';

const PROVIDERS = [
  { value: 'deepseek', label: 'DeepSeek', defaultUrl: 'https://api.deepseek.com' },
  { value: 'openai', label: 'OpenAI', defaultUrl: 'https://api.openai.com/v1' },
  { value: 'claude', label: 'Claude (Anthropic)', defaultUrl: 'https://api.anthropic.com/v1' },
  { value: 'gemini', label: 'Gemini (Google)', defaultUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  { value: 'qwen', label: 'Qwen (通义千问)', defaultUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { value: 'ark', label: 'Ark (火山引擎)', defaultUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  { value: 'ollama', label: 'Ollama (本地)', defaultUrl: 'http://localhost:11434/v1' },
  { value: 'custom', label: 'Custom (OpenAI 兼容)', defaultUrl: '' },
] as const;

const CAPABILITIES = [
  { value: 'text', label: 'Text', icon: Cpu },
  { value: 'vision', label: 'Vision', icon: Eye },
  { value: 'tool', label: 'Tool', icon: Wrench },
] as const;

interface ModelFormProps {
  initial?: AIModelRecord;
  onSave: (input: CreateAIModelInput) => Promise<void>;
  onCancel: () => void;
}

function ModelForm({ initial, onSave, onCancel }: ModelFormProps) {
  const [provider, setProvider] = useState(initial?.provider ?? 'deepseek');
  const [modelName, setModelName] = useState(initial?.modelName ?? '');
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? '');
  const [capabilities, setCapabilities] = useState<string[]>(initial?.capabilities ?? ['text']);
  const [saving, setSaving] = useState(false);

  const toggleCap = (cap: string) => {
    setCapabilities((prev) => prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]);
  };

  const handleSubmit = async () => {
    if (!modelName.trim()) { toast.error('Model name is required'); return; }
    setSaving(true);
    try {
      await onSave({
        provider,
        modelName: modelName.trim(),
        displayName: displayName.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
        capabilities,
      });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Provider</label>
          <select
            value={provider}
            onChange={(e) => {
              const p = e.target.value;
              setProvider(p);
              const found = PROVIDERS.find((pr) => pr.value === p);
              if (found?.defaultUrl) setBaseUrl(found.defaultUrl);
            }}
            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Model Name</label>
          <input
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            placeholder="e.g. deepseek-chat, gpt-4o"
            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Display Name</label>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Optional display name"
          className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Base URL</label>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="Auto-filled by provider"
            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm font-mono"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm font-mono"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Capabilities</label>
        <div className="mt-1 flex gap-2">
          {CAPABILITIES.map((cap) => (
            <button
              key={cap.value}
              onClick={() => toggleCap(cap.value)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                capabilities.includes(cap.value)
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              <cap.icon className="h-3.5 w-3.5" />
              {cap.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {initial ? 'Update' : 'Add Model'}
        </Button>
      </div>
    </div>
  );
}

export default function ModelsPage() {
  const repo = useRepository();
  const t = useT();
  const [models, setModels] = useState<AIModelRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AIModelRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AIModelRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadModels = useCallback(async () => {
    setLoading(true);
    try { setModels(await repo.listModels()); }
    catch { toast.error('Failed to load models'); }
    finally { setLoading(false); }
  }, [repo]);

  useEffect(() => { loadModels(); }, [loadModels]);

  const handleCreate = async (input: CreateAIModelInput) => {
    await repo.createModel(input);
    toast.success('Model added');
    setShowForm(false);
    loadModels();
  };

  const handleUpdate = async (input: CreateAIModelInput) => {
    if (!editing) return;
    await repo.updateModel(editing.id, input);
    toast.success('Model updated');
    setEditing(null);
    loadModels();
  };

  const handleToggle = async (model: AIModelRecord) => {
    await repo.updateModel(model.id, { isEnabled: !model.isEnabled });
    loadModels();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await repo.deleteModel(deleteTarget.id);
      toast.success('Model deleted');
      setDeleteTarget(null);
      loadModels();
    } catch { toast.error('Delete failed'); }
    finally { setDeleting(false); }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Settings2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">AI Models</h1>
            <p className="text-sm text-muted-foreground">Configure LLM providers and models</p>
          </div>
        </div>
        <Button onClick={() => { setEditing(null); setShowForm(true); }}>
          <Plus className="h-4 w-4" />
          Add Model
        </Button>
      </div>

      <div className="flex-1 p-6 space-y-4">
        {/* Create/Edit Form */}
        {(showForm || editing) && (
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-medium">{editing ? 'Edit Model' : 'Add New Model'}</h3>
            <ModelForm
              initial={editing ?? undefined}
              onSave={editing ? handleUpdate : handleCreate}
              onCancel={() => { setShowForm(false); setEditing(null); }}
            />
          </div>
        )}

        {/* Model List */}
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Provider</th>
                <th className="px-4 py-2.5 text-left font-medium">Model</th>
                <th className="px-4 py-2.5 text-left font-medium">Capabilities</th>
                <th className="px-4 py-2.5 text-left font-medium">Base URL</th>
                <th className="px-4 py-2.5 text-center font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />Loading...</td></tr>
              )}
              {!loading && models.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No models configured. Click "Add Model" to get started.</td></tr>
              )}
              {!loading && models.map((m) => (
                <tr key={m.id} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <Badge variant="outline">{PROVIDERS.find((p) => p.value === m.provider)?.label ?? m.provider}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-foreground">{m.displayName || m.modelName}</div>
                    {m.displayName && <div className="text-xs text-muted-foreground font-mono">{m.modelName}</div>}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1">
                      {m.capabilities.map((cap) => (
                        <Badge key={cap} variant="secondary" className="text-xs">{cap}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono max-w-[200px] truncate">
                    {m.baseUrl || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      onClick={() => handleToggle(m)}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        m.isEnabled ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {m.isEnabled ? <><Check className="h-3 w-3" />Enabled</> : <><X className="h-3 w-3" />Disabled</>}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button onClick={() => { setShowForm(false); setEditing(m); }} className="text-xs text-muted-foreground hover:text-primary"><Pencil className="h-3.5 w-3.5" /></button>
                      <button onClick={() => setDeleteTarget(m)} className="text-xs text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
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
        title={deleteTarget ? `Delete model "${deleteTarget.displayName || deleteTarget.modelName}"?` : ''}
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
