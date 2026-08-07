'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface StatsData {
  totals: {
    users: number;
    conversations: number;
    messages: number;
    workflows: number;
    flowRuns: number;
    apiCalls: number;
  };
  runStatus: Record<string, number>;
  dailyConversations: Array<{ date: string; count: number }>;
}

const CARD_STYLE =
  'rounded-lg border border-border p-4 flex flex-col gap-1 min-w-[140px]';

export default function AdminStatsPage() {
  const t = useT();
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/stats');
      const data = await res.json();
      if (data?.totals) setStats(data);
      else toast.error(data?.error || '加载失败');
    } catch {
      toast.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const maxDaily = Math.max(
    1,
    ...(stats?.dailyConversations.map((d) => d.count) || [1]),
  );

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('admin.stats')}</h2>
          <p className="text-sm text-muted-foreground">{t('admin.overview')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadStats} disabled={loading}>
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </Button>
      </div>

      {loading && !stats && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {stats && (
        <div className="space-y-6">
          {/* 统计卡片 */}
          <div className="flex flex-wrap gap-3">
            <div className={CARD_STYLE}>
              <span className="text-xs text-muted-foreground">{t('admin.totalUsers')}</span>
              <span className="text-2xl font-bold">{stats.totals.users}</span>
            </div>
            <div className={CARD_STYLE}>
              <span className="text-xs text-muted-foreground">{t('admin.totalConversations')}</span>
              <span className="text-2xl font-bold">{stats.totals.conversations}</span>
            </div>
            <div className={CARD_STYLE}>
              <span className="text-xs text-muted-foreground">{t('admin.totalMessages')}</span>
              <span className="text-2xl font-bold">{stats.totals.messages}</span>
            </div>
            <div className={CARD_STYLE}>
              <span className="text-xs text-muted-foreground">{t('admin.totalWorkflows')}</span>
              <span className="text-2xl font-bold">{stats.totals.workflows}</span>
            </div>
            <div className={CARD_STYLE}>
              <span className="text-xs text-muted-foreground">{t('admin.totalRuns')}</span>
              <span className="text-2xl font-bold">{stats.totals.flowRuns}</span>
            </div>
            <div className={CARD_STYLE}>
              <span className="text-xs text-muted-foreground">{t('admin.totalApiCalls')}</span>
              <span className="text-2xl font-bold">{stats.totals.apiCalls}</span>
            </div>
          </div>

          {/* {t('admin.runStatus')} */}
          <div className="rounded-lg border border-border p-4">
            <h3 className="mb-3 text-sm font-medium">{t('admin.runStatus')}</h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(stats.runStatus).length === 0 && (
                <span className="text-sm text-muted-foreground">{t('workflows.noExecutionRecords')}</span>
              )}
              {Object.entries(stats.runStatus).map(([status, count]) => (
                <Badge key={status} variant="secondary" className="text-xs">
                  {status === 'completed' ? '成功' : status === 'failed' ? '失败' : status}：{count}
                </Badge>
              ))}
            </div>
          </div>

          {/* 近 7 天对话趋势 */}
          <div className="rounded-lg border border-border p-4">
            <h3 className="mb-4 text-sm font-medium">{t('admin.dailyTrend')}</h3>
            {stats.dailyConversations.every((d) => d.count === 0) ? (
              <p className="text-sm text-muted-foreground">{t('admin.noData')}</p>
            ) : (
              <div className="flex items-end gap-2">
                {stats.dailyConversations.map((d) => (
                  <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                    <span className="text-xs font-medium">{d.count}</span>
                    <div
                      className="w-full rounded-t bg-primary/70"
                      style={{
                        height: `${Math.max(4, (d.count / maxDaily) * 120)}px`,
                      }}
                    />
                    <span className="text-[10px] text-muted-foreground">
                      {d.date.slice(5)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
