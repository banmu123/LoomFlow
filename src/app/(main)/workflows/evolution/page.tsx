'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
  Plus,
  Loader2,
  Play,
  Pause,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Zap,
  GitBranch,
  RefreshCw,
  Shield,
} from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ConfirmDialog';

// ===== Types =====

interface HealthData {
  workflowId: string;
  health: {
    score: number;
    trend: 'stable' | 'declining' | 'improving';
    metrics: {
      successRate: number;
      latencyP95: number;
      costPerRun: number;
      failureRate: number;
      totalRuns: number;
    };
    bottlenecks: Array<{ kind: string; title: string; value: string; suggestion: string }>;
  };
  pendingProposals: number;
  recentEvents: number;
}

interface EvolutionEvent {
  id: string;
  trigger_type: string;
  trigger_reason: string;
  analysis_status: string;
  metric_snapshot: Record<string, unknown> | null;
  proposal_id: string | null;
  created_at: string;
}

interface EvolutionProposal {
  id: string;
  explanation: string;
  risk: string | null;
  status: string;
  schema_valid: boolean;
  diff_markdown: string | null;
  applied_version: number | null;
  created_at: string;
  applied_at: string | null;
  rejected_at: string | null;
}

interface EvolutionRule {
  id: string;
  enabled: boolean;
  trigger_type: string;
  cron_expr: string | null;
  metric_key: string | null;
  metric_op: string | null;
  metric_threshold: number | null;
  metric_range: string | null;
  baseline_range: string | null;
  event_type: string | null;
  event_threshold: number | null;
  cooldown_hours: number;
  last_triggered_at: string | null;
  created_at: string;
}

// ===== Helpers =====

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { hour12: false });
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h ago`;
  return `${Math.floor(ms / 86400_000)}d ago`;
}

const STATUS_ICONS: Record<string, typeof CheckCircle2> = {
  pending: Clock,
  analyzing: Loader2,
  proposal_created: Zap,
  applied: CheckCircle2,
  rejected: XCircle,
  failed: AlertTriangle,
  no_change: Minus,
  rule_evaluated: Play,
  trigger_fired: Zap,
  cooldown_blocked: Pause,
  duplicate_blocked: RefreshCw,
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-muted-foreground',
  analyzing: 'text-blue-500 animate-spin',
  proposal_created: 'text-amber-500',
  applied: 'text-green-600',
  rejected: 'text-destructive',
  failed: 'text-destructive',
  no_change: 'text-muted-foreground',
  trigger_fired: 'text-amber-500',
};

// ===== Page =====

export default function EvolutionPage() {
  const t = useT();

  // We need a workflowId — for now, use a selector or URL param
  // In the canvas context, this would come from the active workflow
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<Array<{ id: string; title: string }>>([]);

  const [health, setHealth] = useState<HealthData | null>(null);
  const [events, setEvents] = useState<EvolutionEvent[]>([]);
  const [proposals, setProposals] = useState<EvolutionProposal[]>([]);
  const [rules, setRules] = useState<EvolutionRule[]>([]);
  const [loading, setLoading] = useState(true);

  // New rule dialog
  const [newRuleOpen, setNewRuleOpen] = useState(false);
  const [newRule, setNewRule] = useState({
    trigger_type: 'cron' as string,
    cron_expr: '0 3 * * *',
    metric_key: 'latency_p95',
    metric_op: 'pct_increase',
    metric_threshold: '0.3',
    metric_range: '7d',
    baseline_range: '30d',
    event_type: 'consecutive_failures',
    event_threshold: '3',
    cooldown_hours: '24',
  });

  // Confirm dialogs
  const [applyTarget, setApplyTarget] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [deleteRuleTarget, setDeleteRuleTarget] = useState<string | null>(null);

  // Diff dialog
  const [diffTarget, setDiffTarget] = useState<EvolutionProposal | null>(null);

  // Load workflow list
  useEffect(() => {
    fetch('/api/workflow-history')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setWorkflows(data.map((w: { id: string; title: string }) => ({ id: w.id, title: w.title })));
          if (data.length > 0 && !workflowId) setWorkflowId(data[0].id);
        }
      })
      .catch(() => {});
  }, []);

  // Load all data when workflowId changes
  const loadData = useCallback(async () => {
    if (!workflowId) return;
    setLoading(true);
    try {
      const [healthRes, eventsRes, proposalsRes, rulesRes] = await Promise.all([
        fetch(`/api/evolution/health?workflowId=${workflowId}`),
        fetch(`/api/evolution/events?workflowId=${workflowId}&limit=30`),
        fetch(`/api/evolution/proposals?workflowId=${workflowId}`),
        fetch(`/api/evolution/rules?workflowId=${workflowId}`),
      ]);
      const [h, e, p, r] = await Promise.all([
        healthRes.json(),
        eventsRes.json(),
        proposalsRes.json(),
        rulesRes.json(),
      ]);
      if (healthRes.ok) setHealth(h);
      if (eventsRes.ok) setEvents(e);
      if (proposalsRes.ok) setProposals(p);
      if (rulesRes.ok) setRules(r);
    } catch {
      toast.error(t('errors.networkError'));
    } finally {
      setLoading(false);
    }
  }, [workflowId, t]);

  useEffect(() => { loadData(); }, [loadData]);

  // Actions
  const handleApply = async (id: string) => {
    const res = await fetch(`/api/evolution/proposals/${id}/apply`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      toast.success(`${t('evolution.applied')} v${data.version}`);
      loadData();
    } else {
      toast.error(data?.error || t('common.failed'));
    }
    setApplyTarget(null);
  };

  const handleReject = async (id: string) => {
    const res = await fetch(`/api/evolution/proposals/${id}/reject`, { method: 'POST' });
    if (res.ok) {
      toast.success(t('evolution.rejected'));
      loadData();
    } else {
      toast.error(t('common.failed'));
    }
    setRejectTarget(null);
  };

  const handleCreateRule = async () => {
    if (!workflowId) return;
    const body: Record<string, unknown> = {
      workflow_id: workflowId,
      trigger_type: newRule.trigger_type,
      cooldown_hours: Number(newRule.cooldown_hours),
    };
    if (newRule.trigger_type === 'cron') {
      body.cron_expr = newRule.cron_expr;
    } else if (newRule.trigger_type === 'metric') {
      body.metric_key = newRule.metric_key;
      body.metric_op = newRule.metric_op;
      body.metric_threshold = Number(newRule.metric_threshold);
      body.metric_range = newRule.metric_range;
      body.baseline_range = newRule.baseline_range;
    } else {
      body.event_type = newRule.event_type;
      body.event_threshold = Number(newRule.event_threshold);
    }

    const res = await fetch('/api/evolution/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      toast.success(t('common.success'));
      setNewRuleOpen(false);
      loadData();
    } else {
      const data = await res.json();
      toast.error(data?.error || t('common.failed'));
    }
  };

  const handleToggleRule = async (rule: EvolutionRule) => {
    await fetch(`/api/evolution/rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !rule.enabled }),
    });
    loadData();
  };

  const handleDeleteRule = async (id: string) => {
    await fetch(`/api/evolution/rules/${id}`, { method: 'DELETE' });
    toast.success(t('common.success'));
    setDeleteRuleTarget(null);
    loadData();
  };

  if (!workflowId && workflows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">{t('workflows.noWorkflows')}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Activity className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">{t('evolution.dashboard')}</h1>
              <p className="text-sm text-muted-foreground">{t('evolution.title')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={workflowId ?? ''} onValueChange={setWorkflowId}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select workflow" />
              </SelectTrigger>
              <SelectContent>
                {workflows.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={loadData}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="mx-auto max-w-6xl space-y-6">
            {/* Health + Proposals row */}
            <div className="grid gap-6 md:grid-cols-2">
              {/* Health Card */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">{t('evolution.health')}</CardTitle>
                </CardHeader>
                <CardContent>
                  {health ? (
                    <div className="space-y-4">
                      <div className="flex items-center gap-4">
                        <div className="text-4xl font-bold">{health.health.score}</div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t('evolution.healthScore')}</p>
                          <div className="flex items-center gap-1 text-sm">
                            {health.health.trend === 'improving' && <TrendingUp className="h-4 w-4 text-green-600" />}
                            {health.health.trend === 'declining' && <TrendingDown className="h-4 w-4 text-destructive" />}
                            {health.health.trend === 'stable' && <Minus className="h-4 w-4 text-muted-foreground" />}
                            <span className={health.health.trend === 'declining' ? 'text-destructive' : ''}>
                              {t(`evolution.trend${health.health.trend.charAt(0).toUpperCase() + health.health.trend.slice(1)}`)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-muted-foreground">Success Rate</p>
                          <p className="font-medium">{health.health.metrics.successRate}%</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">P95 Latency</p>
                          <p className="font-medium">{health.health.metrics.latencyP95}ms</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Failure Rate</p>
                          <p className="font-medium">{health.health.metrics.failureRate}%</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Cost/Run</p>
                          <p className="font-medium">${health.health.metrics.costPerRun.toFixed(4)}</p>
                        </div>
                      </div>
                      {health.health.bottlenecks.length > 0 && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-800 dark:bg-amber-950">
                          <p className="font-medium text-amber-700 dark:text-amber-300">{t('evolution.bottleneck')}</p>
                          {health.health.bottlenecks.map((b, i) => (
                            <p key={i} className="mt-1 text-amber-600 dark:text-amber-400">
                              {b.title}: {b.value}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No data</p>
                  )}
                </CardContent>
              </Card>

              {/* Quality Gate Status Card */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium">
                    <Shield className="h-4 w-4" />
                    {t('qualityGate.title')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {(() => {
                    const gateEvent = events.find((e) => e.trigger_type === 'quality_gate');
                    if (!gateEvent) {
                      return <p className="text-sm text-muted-foreground">No quality gate checks yet</p>;
                    }
                    const meta = gateEvent.metric_snapshot as Record<string, unknown> | null;
                    const decision = (meta?.decision as string) ?? gateEvent.analysis_status;
                    const version = meta?.candidateVersion as number | undefined;
                    const checks = meta?.checks as Array<{ name: string; status: string }> | undefined;
                    const passed = checks?.filter((c) => c.status === 'pass').length ?? 0;
                    const total = checks?.length ?? 0;

                    const decisionConfig: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
                      allow: { icon: CheckCircle2, color: 'text-green-600', label: t('qualityGate.allow') },
                      warning: { icon: AlertTriangle, color: 'text-amber-500', label: t('qualityGate.warning') },
                      block: { icon: XCircle, color: 'text-destructive', label: t('qualityGate.block') },
                    };
                    const cfg = decisionConfig[decision] ?? decisionConfig.allow;
                    const Icon = cfg.icon;

                    return (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Icon className={`h-5 w-5 ${cfg.color}`} />
                          <span className={`text-sm font-semibold ${cfg.color}`}>{cfg.label}</span>
                          {version != null && <Badge variant="outline" className="text-xs">v{version}</Badge>}
                        </div>
                        {total > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {t('qualityGate.passed', { passed, total })}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">{timeAgo(gateEvent.created_at)}</p>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>

              {/* Proposals Card */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">{t('evolution.proposals')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {proposals.filter((p) => p.status === 'pending').length === 0 && (
                      <p className="text-sm text-muted-foreground">{t('evolution.noProposals')}</p>
                    )}
                    {proposals.filter((p) => p.status === 'pending').map((p) => (
                      <div key={p.id} className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <p className="text-sm font-medium">{p.explanation}</p>
                            {p.risk && <p className="mt-1 text-xs text-muted-foreground">{t('evolution.risk')}: {p.risk}</p>}
                            <p className="mt-1 text-xs text-muted-foreground">{timeAgo(p.created_at)}</p>
                          </div>
                        </div>
                        <div className="mt-3 flex gap-2">
                          {p.diff_markdown && (
                            <Button variant="outline" size="sm" onClick={() => setDiffTarget(p)}>
                              {t('evolution.viewDiff')}
                            </Button>
                          )}
                          <Button size="sm" onClick={() => setApplyTarget(p.id)}>
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            {t('evolution.apply')}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setRejectTarget(p.id)}>
                            <XCircle className="mr-1 h-3 w-3" />
                            {t('evolution.reject')}
                          </Button>
                        </div>
                      </div>
                    ))}
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>{t('evolution.appliedProposals')}: {proposals.filter((p) => p.status === 'applied').length}</span>
                      <span>{t('evolution.rejectedProposals')}: {proposals.filter((p) => p.status === 'rejected').length}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Timeline + Rules row */}
            <div className="grid gap-6 md:grid-cols-2">
              {/* Timeline */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">{t('evolution.timeline')}</CardTitle>
                </CardHeader>
                <CardContent>
                  {events.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('evolution.noEvents')}</p>
                  ) : (
                    <div className="space-y-3">
                      {events.map((ev) => {
                        const Icon = STATUS_ICONS[ev.analysis_status] ?? Clock;
                        const color = STATUS_COLORS[ev.analysis_status] ?? 'text-muted-foreground';
                        return (
                          <div key={ev.id} className="flex items-start gap-3">
                            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm">{ev.trigger_reason}</p>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Badge variant="outline" className="text-[10px]">{ev.trigger_type}</Badge>
                                <span>{t(`evolution.${ev.analysis_status === 'proposal_created' ? 'proposals' : ev.analysis_status}`)}</span>
                                <span>{timeAgo(ev.created_at)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Rules */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium">{t('evolution.rules')} ({rules.length})</CardTitle>
                    <Button variant="outline" size="sm" onClick={() => setNewRuleOpen(true)}>
                      <Plus className="mr-1 h-3 w-3" />
                      {t('evolution.newRule')}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {rules.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('evolution.noRules')}</p>
                  ) : (
                    <div className="space-y-2">
                      {rules.map((r) => (
                        <div key={r.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                          <div className="flex items-center gap-3">
                            <Badge variant={r.enabled ? 'default' : 'secondary'}>
                              {r.trigger_type === 'cron' ? t('evolution.triggerCron') : r.trigger_type === 'metric' ? t('evolution.triggerMetric') : t('evolution.triggerEvent')}
                            </Badge>
                            <span className="text-sm">
                              {r.trigger_type === 'cron' && r.cron_expr}
                              {r.trigger_type === 'metric' && `${r.metric_key} ${r.metric_op} ${(Number(r.metric_threshold) * 100).toFixed(0)}%`}
                              {r.trigger_type === 'event' && `${r.event_type} >= ${r.event_threshold}`}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleToggleRule(r)}>
                              {r.enabled ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteRuleTarget(r.id)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>

      {/* New Rule Dialog */}
      <Dialog open={newRuleOpen} onOpenChange={setNewRuleOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('evolution.newRule')}</DialogTitle>
            <DialogDescription>{t('evolution.triggerType')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t('evolution.triggerType')}</Label>
              <Select value={newRule.trigger_type} onValueChange={(v) => setNewRule((f) => ({ ...f, trigger_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cron">{t('evolution.triggerCron')}</SelectItem>
                  <SelectItem value="metric">{t('evolution.triggerMetric')}</SelectItem>
                  <SelectItem value="event">{t('evolution.triggerEvent')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {newRule.trigger_type === 'cron' && (
              <div className="space-y-1.5">
                <Label>{t('evolution.cronExpr')}</Label>
                <Input value={newRule.cron_expr} onChange={(e) => setNewRule((f) => ({ ...f, cron_expr: e.target.value }))} placeholder="0 3 * * *" />
              </div>
            )}

            {newRule.trigger_type === 'metric' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>{t('evolution.metricKey')}</Label>
                    <Select value={newRule.metric_key} onValueChange={(v) => setNewRule((f) => ({ ...f, metric_key: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="latency_p95">P95 Latency</SelectItem>
                        <SelectItem value="failure_rate">Failure Rate</SelectItem>
                        <SelectItem value="success_rate">Success Rate</SelectItem>
                        <SelectItem value="cost_per_run">Cost/Run</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('evolution.metricOp')}</Label>
                    <Select value={newRule.metric_op} onValueChange={(v) => setNewRule((f) => ({ ...f, metric_op: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pct_increase">{'>'} %</SelectItem>
                        <SelectItem value="pct_decrease">{'<'} %</SelectItem>
                        <SelectItem value="gt">{'>'} abs</SelectItem>
                        <SelectItem value="lt">{'<'} abs</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label>{t('evolution.metricThreshold')}</Label>
                    <Input type="number" value={newRule.metric_threshold} onChange={(e) => setNewRule((f) => ({ ...f, metric_threshold: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('evolution.metricRange')}</Label>
                    <Select value={newRule.metric_range} onValueChange={(v) => setNewRule((f) => ({ ...f, metric_range: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="24h">24h</SelectItem>
                        <SelectItem value="7d">7d</SelectItem>
                        <SelectItem value="30d">30d</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('evolution.baselineRange')}</Label>
                    <Select value={newRule.baseline_range} onValueChange={(v) => setNewRule((f) => ({ ...f, baseline_range: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="7d">7d</SelectItem>
                        <SelectItem value="30d">30d</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}

            {newRule.trigger_type === 'event' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('evolution.eventType')}</Label>
                  <Select value={newRule.event_type} onValueChange={(v) => setNewRule((f) => ({ ...f, event_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="consecutive_failures">{t('evolution.consecutiveFailures')}</SelectItem>
                      <SelectItem value="consecutive_timeouts">{t('evolution.consecutiveTimeouts')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t('evolution.eventThreshold')}</Label>
                  <Input type="number" value={newRule.event_threshold} onChange={(e) => setNewRule((f) => ({ ...f, event_threshold: e.target.value }))} />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>{t('evolution.cooldownHours')}</Label>
              <Input type="number" value={newRule.cooldown_hours} onChange={(e) => setNewRule((f) => ({ ...f, cooldown_hours: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewRuleOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleCreateRule}>{t('common.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diff Dialog */}
      <Dialog open={!!diffTarget} onOpenChange={(open) => !open && setDiffTarget(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('evolution.viewDiff')}</DialogTitle>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-4 text-xs">{diffTarget?.diff_markdown}</pre>
        </DialogContent>
      </Dialog>

      {/* Confirm Apply */}
      <ConfirmDialog
        open={!!applyTarget}
        title={t('evolution.confirmApply')}
        onConfirm={() => applyTarget && handleApply(applyTarget)}
        onCancel={() => setApplyTarget(null)}
      />

      {/* Confirm Reject */}
      <ConfirmDialog
        open={!!rejectTarget}
        destructive
        title={t('evolution.confirmReject')}
        onConfirm={() => rejectTarget && handleReject(rejectTarget)}
        onCancel={() => setRejectTarget(null)}
      />

      {/* Confirm Delete Rule */}
      <ConfirmDialog
        open={!!deleteRuleTarget}
        destructive
        title={t('common.delete') + '?'}
        onConfirm={() => deleteRuleTarget && handleDeleteRule(deleteRuleTarget)}
        onCancel={() => setDeleteRuleTarget(null)}
      />
    </div>
  );
}
