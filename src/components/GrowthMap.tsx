'use client';

import { useState } from 'react';
import { Lock, FlaskConical, Hammer, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Journey, Capability } from '@/lib/growth/types';
import { CAPABILITY_STATUSES } from '@/lib/growth/types';

// ===== Growth Map：Journey 可视化路线图 =====
// 纵向节点链（Goal → 阶段 → 阶段 → …），点击节点查看详情/推进状态
// 状态：Locked(灰) / Exploring(蓝) / Developing(琥珀) / Mastered(绿)

export const CAP_STATUS_META: Record<
  string,
  { icon: typeof Lock; labelKey: string; dotClass: string; ringClass: string }
> = {
  locked: {
    icon: Lock,
    labelKey: 'growth.capStatusLocked',
    dotClass: 'border-2 border-muted-foreground/50 bg-background text-muted-foreground/60',
    ringClass: 'hover:border-muted-foreground/60',
  },
  exploring: {
    icon: FlaskConical,
    labelKey: 'growth.capStatusExploring',
    dotClass: 'bg-blue-500 text-white',
    ringClass: 'hover:border-blue-400',
  },
  developing: {
    icon: Hammer,
    labelKey: 'growth.capStatusDeveloping',
    dotClass: 'bg-amber-500 text-white',
    ringClass: 'hover:border-amber-400',
  },
  mastered: {
    icon: CheckCircle2,
    labelKey: 'growth.capStatusMastered',
    dotClass: 'bg-green-500 text-white',
    ringClass: 'hover:border-green-400',
  },
};

export function GrowthMap({
  journey,
  onUpdate,
}: {
  journey: Journey & { capabilities: Capability[] };
  onUpdate: () => void;
}) {
  const t = useT();
  const [selected, setSelected] = useState<Capability | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [updating, setUpdating] = useState(false);

  const caps = journey.capabilities;

  const updateStatus = async (cap: Capability, status: Capability['status']) => {
    setUpdating(true);
    try {
      const res = await fetch(`/api/growth/capabilities/${cap.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setSelected((prev) => (prev?.id === cap.id ? { ...prev, status } : prev));
        onUpdate();
      }
    } catch {
      // ignore
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Journey 头 */}
      <div
        className="flex cursor-pointer items-center gap-2 px-4 py-2.5"
        onClick={() => setCollapsed((v) => !v)}
      >
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">{journey.title}</p>
          {journey.description && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{journey.description}</p>
          )}
        </div>
        <Badge variant="outline" className="shrink-0">
          {caps.length} {t('growth.capability')}
        </Badge>
        {collapsed ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </div>

      {/* 路线图（节点链） */}
      {!collapsed && (
        <div className="border-t border-border/60 px-6 py-4">
          {caps.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              {t('growth.noCapabilities')}
            </p>
          ) : (
            <div className="flex flex-col">
              {caps.map((cap, idx) => {
                const meta = CAP_STATUS_META[cap.status] ?? CAP_STATUS_META.locked;
                const Icon = meta.icon;
                const isLast = idx === caps.length - 1;
                return (
                  <div key={cap.id} className="flex flex-col">
                    {/* 节点 */}
                    <button
                      onClick={() => setSelected(cap)}
                      className={cn(
                        'group flex items-center gap-3 rounded-lg border border-transparent px-2 py-2 text-left transition-colors',
                        meta.ringClass,
                      )}
                    >
                      {/* 状态图标（圆点） */}
                      <span
                        className={cn(
                          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-sm transition-transform group-hover:scale-105',
                          meta.dotClass,
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {cap.title}
                        </span>
                        {cap.description && (
                          <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground">
                            {cap.description}
                          </span>
                        )}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                          cap.status === 'mastered'
                            ? 'bg-green-500/10 text-green-600'
                            : cap.status === 'developing'
                              ? 'bg-amber-500/10 text-amber-600'
                              : cap.status === 'exploring'
                                ? 'bg-blue-500/10 text-blue-600'
                                : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {t(meta.labelKey)}
                      </span>
                    </button>

                    {/* 连接线（节点间） */}
                    {!isLast && (
                      <div className="ml-[17px] h-5 w-px bg-border" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Capability Detail */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selected && (
                <>
                  <span
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-full',
                      CAP_STATUS_META[selected.status]?.dotClass ?? CAP_STATUS_META.locked.dotClass,
                    )}
                  >
                    {(() => {
                      const Icon = CAP_STATUS_META[selected.status]?.icon ?? Lock;
                      return <Icon className="h-3 w-3" />;
                    })()}
                  </span>
                  {selected.title}
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 py-2">
              {/* 状态切换（四态，无 XP/Level） */}
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  {t('growth.capStatus')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {CAPABILITY_STATUSES.map((st) => (
                    <button
                      key={st}
                      type="button"
                      disabled={updating}
                      onClick={() => updateStatus(selected, st)}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs transition-colors',
                        selected.status === st
                          ? st === 'mastered'
                            ? 'border-green-500 bg-green-500/10 text-green-600'
                            : st === 'developing'
                              ? 'border-amber-500 bg-amber-500/10 text-amber-600'
                              : st === 'exploring'
                                ? 'border-blue-500 bg-blue-500/10 text-blue-600'
                                : 'border-muted-foreground/50 bg-muted text-muted-foreground'
                          : 'border-border text-muted-foreground hover:border-primary/40 hover:text-primary',
                      )}
                    >
                      {t(CAP_STATUS_META[st].labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              {selected.description && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    {t('growth.capDescription')}
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-foreground">
                    {selected.description}
                  </p>
                </div>
              )}

              {selected.prerequisites && selected.prerequisites.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                    {t('growth.capPrerequisites')}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.prerequisites.map((p) => (
                      <Badge key={p} variant="secondary" className="text-[10px]">
                        {p}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => setSelected(null)}>
                  {t('common.close')}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
