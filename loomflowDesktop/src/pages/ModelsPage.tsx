/**
 * ModelsPage — 模型配置管理
 *
 * 与 Web 端 Admin Models 对齐：CRUD、provider 选择、能力标签、启用/禁用。
 * 所有用户可见文字均走 i18n（AGENTS.md 第 7 条）。
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
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

/** 提供商清单：label 为品牌名（不翻译），defaultUrl 用于自动填充接口地址 */
const PROVIDERS = [
  { value: 'deepseek', label: 'DeepSeek', defaultUrl: 'https://api.deepseek.com' },
  { value: 'openai', label: 'OpenAI', defaultUrl: 'https://api.openai.com/v1' },
  { value: 'claude', label: 'Claude (Anthropic)', defaultUrl: 'https://api.anthropic.com/v1' },
  { value: 'gemini', label: 'Gemini (Google)', defaultUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  { value: 'qwen', label: 'Qwen', defaultUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { value: 'ark', label: 'Ark (Volcengine)', defaultUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  { value: 'ollama', label: 'Ollama', defaultUrl: 'http://localhost:11434/v1' },
  { value: 'custom', label: 'Custom', defaultUrl: '' },
] as const;

/** 提供商的中文补充说明（紧跟品牌名后展示） */
const PROVIDER_HINTS: Record<string, string> = {
  qwen: 'qwenHint',
  ark: 'arkHint',
  ollama: 'ollamaHint',
  custom: 'customHint',
};

const CAPABILITIES = [
  { value: 'text', labelKey: 'capText', icon: Cpu },
  { value: 'vision', labelKey: 'capVision', icon: Eye },
  { value: 'tool', labelKey: 'capTool', icon: Wrench },
] as const;

interface ModelFormProps {
  initial?: AIModelRecord;
  onSave: (input: CreateAIModelInput) => Promise<void>;
  onCancel: () => void;
}

function ModelForm({ initial, onSave, onCancel }: ModelFormProps) {
  const t = useT();
  const [provider, setProvider] = useState(initial?.provider ?? 'deepseek');
  const [modelName, setModelName] = useState(initial?.modelName ?? '');
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? '');
  const [capabilities, setCapabilities] = useState<string[]>(initial?.capabilities ?? ['text']);
  const [saving, setSaving] = useState(false);

  const toggleCap = (cap: string) => {
    setCapabilities((prev) => (prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]));
  };

  const handleSubmit = async () => {
    if (!modelName.trim()) { toast.error(t('models.nameRequired')); return; }
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

  const fieldCls = 'mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground">{t('models.provider')}</label>
          <select
            value={provider}
            onChange={(e) => {
              const p = e.target.value;
              setProvider(p);
              const found = PROVIDERS.find((pr) => pr.value === p);
              if (found?.defaultUrl) setBaseUrl(found.defaultUrl);
            }}
            className={fieldCls}
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {PROVIDER_HINTS[p.value] ? `${p.label} (${t(`models.${PROVIDER_HINTS[p.value]}`)})` : p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">{t('models.modelName')}</label>
          <input
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            placeholder={t('models.modelNamePlaceholder')}
            className={fieldCls}
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">{t('models.displayName')}</label>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={t('models.displayNamePlaceholder')}
          className={fieldCls}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground">{t('models.baseUrl')}</label>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={t('models.baseUrlPlaceholder')}
            className={`${fieldCls} font-mono`}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">{t('models.apiKey')}</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className={`${fieldCls} font-mono`}
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">{t('models.capabilities')}</label>
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
              {t(`models.${cap.labelKey}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel}>{t('models.cancel')}</Button>
        <Button onClick={handleSubmit} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {initial ? t('models.update') : t('models.create')}
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

  /** provider value → 展示名 */
  const providerLabels = useMemo(
    () => Object.fromEntries(PROVIDERS.map((p) => [p.value, p.label])) as Record<string, string>,
    [],
  );

  const loadModels = useCallback(async () => {
    setLoading(true);
    try { setModels(await repo.listModels()); }
    catch { toast.error(t('models.loadFailed')); }
    finally { setLoading(false); }
  }, [repo, t]);

  useEffect(() => { loadModels(); }, [loadModels]);

  const handleCreate = async (input: CreateAIModelInput) => {
    try {
      await repo.createModel(input);
      toast.success(t('models.added'));
      setShowForm(false);
      loadModels();
    } catch { toast.error(t('models.addFailed')); }
  };

  const handleUpdate = async (input: CreateAIModelInput) => {
    if (!editing) return;
    try {
      await repo.updateModel(editing.id, input);
      toast.success(t('models.updated'));
      setEditing(null);
      loadModels();
    } catch { toast.error(t('models.updateFailed')); }
  };

  const handleToggle = async (model: AIModelRecord) => {
    try {
      await repo.updateModel(model.id, { isEnabled: !model.isEnabled });
      loadModels();
    } catch { toast.error(t('models.updateFailed')); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await repo.deleteModel(deleteTarget.id);
      toast.success(t('models.deleted'));
      setDeleteTarget(null);
      loadModels();
    } catch { toast.error(t('models.deleteFailed')); }
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
            <h1 className="text-lg font-semibold text-foreground">{t('models.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('models.subtitle')}</p>
          </div>
        </div>
        <Button onClick={() => { setEditing(null); setShowForm(true); }}>
          <Plus className="h-4 w-4" />
          {t('models.add')}
        </Button>
      </div>

      <div className="flex-1 space-y-4 p-6">
        {/* Create/Edit Form */}
        {(showForm || editing) && (
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-medium">{editing ? t('models.editTitle') : t('models.addTitle')}</h3>
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
                <th className="px-4 py-2.5 text-left font-medium">{t('models.colProvider')}</th>
                <th className="px-4 py-2.5 text-left font-medium">{t('models.colModel')}</th>
                <th className="px-4 py-2.5 text-left font-medium">{t('models.colCapabilities')}</th>
                <th className="px-4 py-2.5 text-left font-medium">{t('models.colBaseUrl')}</th>
                <th className="px-4 py-2.5 text-center font-medium">{t('models.colStatus')}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t('models.colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />{t('models.loading')}</td></tr>
              )}
              {!loading && models.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">{t('models.empty')}</td></tr>
              )}
              {!loading && models.map((m) => (
                <tr key={m.id} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <Badge variant="outline">{providerLabels[m.provider] ?? m.provider}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-foreground">{m.displayName || m.modelName}</div>
                    {m.displayName && <div className="font-mono text-xs text-muted-foreground">{m.modelName}</div>}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1">
                      {m.capabilities.map((cap) => (
                        <Badge key={cap} variant="secondary" className="text-xs">{cap}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="max-w-[200px] truncate px-4 py-2.5 font-mono text-xs text-muted-foreground">
                    {m.baseUrl || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      onClick={() => handleToggle(m)}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        m.isEnabled ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {m.isEnabled ? <><Check className="h-3 w-3" />{t('models.enabled')}</> : <><X className="h-3 w-3" />{t('models.disabled')}</>}
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
        title={deleteTarget ? t('models.deleteConfirm', { name: deleteTarget.displayName || deleteTarget.modelName }) : ''}
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
