'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save, Trash2, Cloud } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useT } from '@/lib/i18n';

interface OSSConfigForm {
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  region: string;
  endpoint: string;
}

export default function AdminOSSConfigPage() {
  const t = useT();
  const [form, setForm] = useState<OSSConfigForm>({
    accessKeyId: '',
    accessKeySecret: '',
    bucket: '',
    region: 'oss-cn-shenzhen',
    endpoint: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/oss-config');
      const data = await res.json();
      if (data && !data.error) {
        setForm({
          accessKeyId: data.accessKeyId || '',
          accessKeySecret: data.accessKeySecret || '',
          bucket: data.bucket || '',
          region: data.region || 'oss-cn-shenzhen',
          endpoint: data.endpoint || '',
        });
      }
    } catch {
      toast.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    if (!form.accessKeyId || !form.accessKeySecret || !form.bucket || !form.region) {
      toast.error('AccessKey ID、Secret、Bucket、Region 均不能为空');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/oss-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('OSS 配置已保存并生效（无需重启）');
      } else {
        toast.error(data?.error || '保存失败');
      }
    } catch {
      toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    try {
      const res = await fetch('/api/admin/oss-config', { method: 'DELETE' });
      if (res.ok) {
        toast.success('已清除 OSS 配置');
        setForm({ accessKeyId: '', accessKeySecret: '', bucket: '', region: 'oss-cn-shenzhen', endpoint: '' });
        setClearConfirm(false);
      } else {
        toast.error('清除失败');
      }
    } catch {
      toast.error('清除失败');
    }
  };

  return (
    <div className="p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">{t('admin.ossTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('admin.ossSubtitle')}</p>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('common.loading')}
        </p>
      ) : (
        <div className="max-w-lg space-y-4">
          <div className="space-y-1.5">
            <Label>
              AccessKey ID <span className="text-destructive">*</span>
            </Label>
            <Input
              value={form.accessKeyId}
              onChange={(e) => setForm((f) => ({ ...f, accessKeyId: e.target.value }))}
              placeholder="LTAI..."
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              AccessKey Secret <span className="text-destructive">*</span>
            </Label>
            <Input
              type="password"
              value={form.accessKeySecret}
              onChange={(e) => setForm((f) => ({ ...f, accessKeySecret: e.target.value }))}
              placeholder="••••••••"
              className="font-mono text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>
                Bucket <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.bucket}
                onChange={(e) => setForm((f) => ({ ...f, bucket: e.target.value }))}
                placeholder="my-bucket"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Region <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.region}
                onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}
                placeholder="oss-cn-shenzhen"
                className="font-mono text-sm"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t('admin.ossEndpoint')}</Label>
            <Input
              value={form.endpoint}
              onChange={(e) => setForm((f) => ({ ...f, endpoint: e.target.value }))}
              placeholder={t('admin.ossEndpointPlaceholder')}
              className="font-mono text-sm"
            />
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
              {t('common.save')}
            </Button>
            <Button variant="ghost" className="hover:text-destructive" onClick={() => setClearConfirm(true)}>
              <Trash2 className="mr-1 h-4 w-4" />
              {t('admin.ossClear')}
            </Button>
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <p className="mb-1 flex items-center gap-1 font-medium text-foreground">
              <Cloud className="h-3.5 w-3.5" />
              {t('admin.ossNoteTitle')}
            </p>
            <p>{t('admin.ossNote1')}</p>
            <p>{t('admin.ossNote2')}</p>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={clearConfirm}
        destructive
        title={t('admin.ossClearConfirm')}
        onConfirm={handleClear}
        onCancel={() => setClearConfirm(false)}
      />
    </div>
  );
}
