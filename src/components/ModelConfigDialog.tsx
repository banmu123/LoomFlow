'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useT } from '@/lib/i18n';

const PROVIDERS = ['deepseek', 'ark', 'openai-compatible', 'custom'];
const CAPABILITIES = ['text', 'vision'];

interface ModelConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 配置成功后回调（用于刷新模型列表） */
  onConfigured?: () => void;
}

// 模型配置弹窗：对话页无模型时的引导入口（仅 admin 可提交）
export function ModelConfigDialog({ open, onOpenChange, onConfigured }: ModelConfigDialogProps) {
  const t = useT();
  const [form, setForm] = useState({
    id: '',
    provider: 'deepseek',
    label: '',
    base_url: '',
    api_key: '',
    capabilities: ['text'] as string[],
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        id: '',
        provider: 'deepseek',
        label: '',
        base_url: '',
        api_key: '',
        capabilities: ['text'],
      });
    }
  }, [open]);

  const toggleCapability = (cap: string) => {
    setForm((f) => ({
      ...f,
      capabilities: f.capabilities.includes(cap)
        ? f.capabilities.filter((c) => c !== cap)
        : [...f.capabilities, cap],
    }));
  };

  const handleSubmit = async () => {
    if (!form.id.trim() || !form.api_key.trim()) {
      toast.error(t('modelConfig.modelIdAndKeyRequired'));
      return;
    }
    if (form.capabilities.length === 0) {
      toast.error(t('modelConfig.capabilityRequired'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ai/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: form.id.trim(),
          provider: form.provider,
          capabilities: form.capabilities,
          label: form.label.trim() || null,
          base_url: form.base_url.trim() || null,
          api_key: form.api_key.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(t('modelConfig.modelConfigured', { id: data.id }));
        onOpenChange(false);
        onConfigured?.();
      } else {
        toast.error(data?.error || t('modelConfig.configFailed'));
      }
    } catch {
      toast.error(t('modelConfig.configFailedNetwork'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('chat.configureModel')}</DialogTitle>
          <DialogDescription>{t('chat.configureModelHint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>
              {t('modelConfig.modelId')} <span className="text-destructive">*</span>
            </Label>
            <Input
              value={form.id}
              onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
              placeholder="deepseek-v4-flash / qwen-vl-max"
              className="font-mono text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Provider</Label>
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
              <Label>{t('chat.modelLabel')}</Label>
              <Input
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="DeepSeek Flash"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t('chat.modelBaseUrl')}</Label>
            <Input
              value={form.base_url}
              onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
              placeholder={t('modelConfig.baseurlPlaceholder')}
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              API Key <span className="text-destructive">*</span>
            </Label>
            <Input
              type="password"
              value={form.api_key}
              onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
              placeholder="sk-..."
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('chat.modelCapabilities')}</Label>
            <div className="grid grid-cols-2 gap-2">
              {CAPABILITIES.map((cap) => (
                <label key={cap} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.capabilities.includes(cap)}
                    onCheckedChange={() => toggleCapability(cap)}
                  />
                  {cap}
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {t('chat.configureModelSave')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
