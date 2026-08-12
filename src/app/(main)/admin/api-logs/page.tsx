'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface ApiCallLog {
  id: string;
  workflow_id: string;
  status: string;
  inputs: Record<string, unknown> | null;
  outputs: Record<string, unknown> | null;
  error: string | null;
  duration_ms: number | null;
  ip: string | null;
  created_at: string;
  workflow_history: { title: string } | null;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

export default function AdminApiLogsPage() {
  const t = useT();
  const [logs, setLogs] = useState<ApiCallLog[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/api-call-logs');
      const data = await res.json();
      if (Array.isArray(data)) setLogs(data);
      else toast.error(data?.error || '加载失败');
    } catch {
      toast.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('admin.apiLogs')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('admin.apiLogsDesc')}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadLogs} disabled={loading}>
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.time')}</TableHead>
              <TableHead>{t('admin.workflow')}</TableHead>
              <TableHead>{t('workflows.status')}</TableHead>
              <TableHead>{t('admin.duration')}</TableHead>
              <TableHead>{t('admin.ip')}</TableHead>
              <TableHead>{t('admin.inputOutput')}</TableHead>
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
            {!loading && logs.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  {t('admin.noApiLogs')}
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatTime(log.created_at)}
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate font-medium">
                    {log.workflow_history?.title || t('admin.deletedWorkflow')}
                  </TableCell>
                  <TableCell>
                    <Badge variant={log.status === 'success' ? 'default' : 'destructive'}>
                      {log.status === 'success' ? t('common.success') : t('common.failed')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {log.duration_ms != null ? `${log.duration_ms}ms` : '-'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{log.ip || '-'}</TableCell>
                  <TableCell className="max-w-[240px]">
                    {log.error ? (
                      <span className="block break-all text-[11px] text-red-500">
                        {log.error}
                      </span>
                    ) : (
                      <code className="block max-h-16 overflow-y-auto break-all rounded bg-muted px-1.5 py-0.5 text-[11px]">
                        {JSON.stringify(log.outputs || log.inputs || {})}
                      </code>
                    )}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
