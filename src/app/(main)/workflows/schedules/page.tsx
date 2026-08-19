'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Clock, Plus, RefreshCw, Trash2, Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
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

interface Schedule {
  id: string;
  workflow_id: string;
  cron_expr: string;
  inputs: Record<string, unknown> | null;
  webhook_url: string | null;
  enabled: boolean;
  last_run_at: string | null;
  created_at: string;
  workflow_history: { title: string } | null;
}

interface WorkflowOption {
  id: string;
  title: string;
}

import { FREQUENCY_PRESETS } from '@/lib/schedules-presets';

const EMPTY_FORM = {
  workflow_id: '',
  cron_expr: '',
  inputs: '{}',
  webhook_url: '',
  enabled: true,
};

function formatTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

export default function WorkflowSchedulesPage() {
  const t = useT();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [schedRes, wfRes] = await Promise.all([
        fetch('/api/schedules'),
        fetch('/api/workflow-history'),
      ]);
      const scheds = await schedRes.json();
      const wfs = await wfRes.json();
      if (Array.isArray(scheds)) setSchedules(scheds);
      if (Array.isArray(wfs)) {
        setWorkflows(wfs.map((w: WorkflowOption) => ({ id: w.id, title: w.title })));
      }
    } catch {
      toast.error(t('schedules.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setDialogOpen(true);
  };

  const openEdit = (s: Schedule) => {
    setEditingId(s.id);
    setForm({
      workflow_id: s.workflow_id,
      cron_expr: s.cron_expr,
      inputs: JSON.stringify(s.inputs || {}, null, 2),
      webhook_url: s.webhook_url || '',
      enabled: s.enabled,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.workflow_id || !form.cron_expr.trim()) {
      toast.error(t('schedules.selectWorkflowAndCron'));
      return;
    }
    setSaving(true);
    try {
      let inputs: Record<string, unknown> = {};
      try {
        inputs = JSON.parse(form.inputs || '{}');
      } catch {
        toast.error(t('schedules.invalidInputsJson'));
        setSaving(false);
        return;
      }

      const payload = {
        workflow_id: form.workflow_id,
        cron_expr: form.cron_expr.trim(),
        inputs,
        webhook_url: form.webhook_url.trim() || null,
        enabled: form.enabled,
      };

      const res = await fetch(
        editingId ? `/api/schedules/${editingId}` : '/api/schedules',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (res.ok) {
        toast.success(editingId ? t('schedules.updated') : t('schedules.created'));
        setDialogOpen(false);
        loadData();
      } else {
        toast.error(data?.error || t('schedules.saveFailed'));
      }
    } catch {
      toast.error(t('schedules.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (s: Schedule, enabled: boolean) => {
    try {
      const res = await fetch(`/api/schedules/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        toast.success(enabled ? t('schedules.enabledOn') : t('schedules.enabledOff'));
        loadData();
      } else {
        toast.error(t('schedules.operationFailed'));
      }
    } catch {
      toast.error(t('schedules.operationFailed'));
    }
  };

  // 统一确认弹窗（替代原生 confirm）
  const [deleteTarget, setDeleteTarget] = useState<Schedule | null>(null);

  const handleDelete = async (s: Schedule) => {
    try {
      const res = await fetch(`/api/schedules/${s.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(t('schedules.deleted'));
        loadData();
      } else {
        toast.error(t('schedules.deleteFailed'));
      }
    } catch {
      toast.error(t('schedules.deleteFailed'));
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <Link href="/workflows">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-1 h-4 w-4" />
              {t('common.back')}
            </Button>
          </Link>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Clock className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">{t('schedules.title')}</h1>
            <p className="text-sm text-muted-foreground">
              {t('schedules.subtitle')}
              {t('schedules.timezoneHint')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('schedules.newTask')}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-6">
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('schedules.workflow')}</TableHead>
                <TableHead>{t('schedules.cronExpr')}</TableHead>
                <TableHead>{t('schedules.webhook')}</TableHead>
                <TableHead>{t('schedules.status')}</TableHead>
                <TableHead>{t('schedules.lastRun')}</TableHead>
                <TableHead className="text-right">{t('schedules.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                    {t('common.loading')}
                  </TableCell>
                </TableRow>
              )}
              {!loading && schedules.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    {t('schedules.noTasks')}
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                schedules.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="max-w-[180px] truncate font-medium">
                      {s.workflow_history?.title || t('schedules.deletedWorkflow')}
                    </TableCell>
                    <TableCell>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                        {s.cron_expr}
                      </code>
                    </TableCell>
                    <TableCell className="max-w-[140px] truncate text-muted-foreground">
                      {s.webhook_url ? (
                        <span className="text-xs">{s.webhook_url}</span>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={s.enabled}
                        onCheckedChange={(v) => handleToggle(s, v)}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatTime(s.last_run_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-2">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(s)} title={t('common.edit')}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 hover:text-destructive"
                          onClick={() => setDeleteTarget(s)}
                          title={t('common.delete')}
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
      </div>

      {/* 新建/编辑对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? t('schedules.editTask') : t('schedules.newTask')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t('schedules.workflow')} *</Label>
              <Select
                value={form.workflow_id}
                onValueChange={(v) => setForm((f) => ({ ...f, workflow_id: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('schedules.selectWorkflow')} />
                </SelectTrigger>
                <SelectContent>
                  {workflows.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('schedules.frequency')} *</Label>
              <div className="flex flex-wrap gap-1.5">
                {FREQUENCY_PRESETS.map((p) => (
                  <button
                    key={p.cron}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, cron_expr: p.cron }))}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs transition-colors',
                      form.cron_expr === p.cron
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/40 hover:text-primary',
                    )}
                  >
                    {t(p.labelKey)}
                  </button>
                ))}
              </div>
              <Label>{t('schedules.cronExpr')} *</Label>
              <Input
                value={form.cron_expr}
                onChange={(e) => setForm((f) => ({ ...f, cron_expr: e.target.value }))}
                placeholder={t('schedules.cronPlaceholder')}
                className="font-mono text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                {t('schedules.cronHint')}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>{t('schedules.inputs')}</Label>
              <Textarea
                value={form.inputs}
                onChange={(e) => setForm((f) => ({ ...f, inputs: e.target.value }))}
                className="min-h-[80px] font-mono text-xs"
                placeholder='{"prompt": "每天生成一份日报"}'
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('schedules.webhookUrl')}</Label>
              <Input
                value={form.webhook_url}
                onChange={(e) => setForm((f) => ({ ...f, webhook_url: e.target.value }))}
                placeholder="https://your-server.com/webhook"
              />
              <p className="text-[11px] text-muted-foreground">
                {t('schedules.webhookHint')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
              />
              <span className="text-sm">{t('schedules.enabled')}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 统一确认弹窗（替代原生 confirm） */}
      <ConfirmDialog
        open={!!deleteTarget}
        destructive
        title={
          deleteTarget
            ? t('schedules.deleteConfirm', { expr: deleteTarget.cron_expr })
            : ''
        }
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
