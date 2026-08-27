/**
 * Evolution Engine — Trigger Detector
 *
 * 按 trigger_type 检测触发条件是否满足。
 * 输出：DetectionResult（triggered + reason + snapshot）
 *
 * 不做的事：不评估 cooldown，不调 AI，不写 DB。
 * 由 scheduler 调用（evaluateRule 通过后才进入此模块）。
 */

import { supabase } from '@/lib/supabase/server';
import {
  aggregateWorkflowMetrics,
  type RunRecordLike,
  type WorkflowMetrics,
} from '../workflow-eval/metrics';
import type { EvolutionRule, DetectionResult, MetricSnapshot } from './types';

// ===== Public API =====

/** cron 触发：无条件 */
export function detectCron(rule: EvolutionRule): DetectionResult {
  return {
    triggered: true,
    reason: `定时触发（${rule.cron_expr}）`,
  };
}

/** metric 触发：当前窗口 vs 基线窗口指标对比 */
export async function detectMetric(rule: EvolutionRule): Promise<DetectionResult> {
  const metricKey = rule.metric_key;
  const metricOp = rule.metric_op;
  const threshold = rule.metric_threshold;

  if (!metricKey || !metricOp || threshold === null) {
    return { triggered: false, reason: '规则配置不完整' };
  }

  const currentRuns = await fetchRuns(rule.workflow_id, rule.metric_range ?? '7d');
  if (currentRuns.length < 3) {
    return { triggered: false, reason: `数据不足（${currentRuns.length} 次执行）` };
  }

  const baselineRuns = await fetchRuns(rule.workflow_id, rule.baseline_range ?? '30d');
  const current = aggregateWorkflowMetrics(currentRuns);
  const baseline = baselineRuns.length > 0 ? aggregateWorkflowMetrics(baselineRuns) : undefined;
  const delta = baseline ? buildDelta(current, baseline) : undefined;

  const currentVal = getMetricValue(metricKey, current);
  const baselineVal = baseline ? getMetricValue(metricKey, baseline) : null;

  const { triggered, reason } = evaluateCondition(metricOp, threshold, currentVal, baselineVal, metricKey);

  return {
    triggered,
    reason,
    snapshot: { current, baseline, delta },
  };
}

/** event 触发：连续失败 / 连续超时 */
export async function detectEvent(rule: EvolutionRule): Promise<DetectionResult> {
  const eventType = rule.event_type;
  const threshold = rule.event_threshold ?? 3;

  if (!eventType) {
    return { triggered: false, reason: '规则配置不完整' };
  }

  const { data } = await supabase
    .from('flow_runs')
    .select('status, created_at')
    .eq('workflow_id', rule.workflow_id)
    .order('created_at', { ascending: false })
    .limit(threshold);

  const recent = (data ?? []) as Array<{ status: string; created_at: string }>;
  if (recent.length < threshold) {
    return { triggered: false, reason: `执行次数不足（${recent.length}/${threshold}）` };
  }

  if (eventType === 'consecutive_failures') {
    const allFailed = recent.every((r) => r.status === 'failed');
    return {
      triggered: allFailed,
      reason: allFailed ? `最近 ${threshold} 次执行全部失败` : '',
    };
  }

  if (eventType === 'consecutive_timeouts') {
    const allTimeout = recent.every((r) => r.status === 'timeout');
    return {
      triggered: allTimeout,
      reason: allTimeout ? `最近 ${threshold} 次执行全部超时` : '',
    };
  }

  return { triggered: false, reason: `未知事件类型: ${eventType}` };
}

// ===== Condition Evaluation =====

function evaluateCondition(
  op: string,
  threshold: number,
  currentVal: number | null,
  baselineVal: number | null,
  key: string,
): { triggered: boolean; reason: string } {
  if (currentVal === null) {
    return { triggered: false, reason: '当前指标数据不足' };
  }

  switch (op) {
    case 'gt':
      return {
        triggered: currentVal > threshold,
        reason: `${formatKey(key)} = ${formatVal(key, currentVal)}（阈值 ${formatVal(key, threshold)}）`,
      };
    case 'lt':
      return {
        triggered: currentVal < threshold,
        reason: `${formatKey(key)} = ${formatVal(key, currentVal)}（阈值 ${formatVal(key, threshold)}）`,
      };
    case 'gte':
      return {
        triggered: currentVal >= threshold,
        reason: `${formatKey(key)} = ${formatVal(key, currentVal)}（阈值 ${formatVal(key, threshold)}）`,
      };
    case 'lte':
      return {
        triggered: currentVal <= threshold,
        reason: `${formatKey(key)} = ${formatVal(key, currentVal)}（阈值 ${formatVal(key, threshold)}）`,
      };
    case 'pct_increase': {
      if (baselineVal === null || baselineVal === 0) {
        return { triggered: false, reason: '基线数据不足' };
      }
      const pct = (currentVal - baselineVal) / baselineVal;
      return {
        triggered: pct >= threshold,
        reason: `${formatKey(key)} 较基线增长 ${(pct * 100).toFixed(1)}%（阈值 ${(threshold * 100).toFixed(0)}%）`,
      };
    }
    case 'pct_decrease': {
      if (baselineVal === null || baselineVal === 0) {
        return { triggered: false, reason: '基线数据不足' };
      }
      const pct = (baselineVal - currentVal) / baselineVal;
      return {
        triggered: pct >= threshold,
        reason: `${formatKey(key)} 较基线下降 ${(pct * 100).toFixed(1)}%（阈值 ${(threshold * 100).toFixed(0)}%）`,
      };
    }
    default:
      return { triggered: false, reason: `未知操作符: ${op}` };
  }
}

// ===== Metric Helpers =====

function getMetricValue(key: string, m: WorkflowMetrics): number | null {
  switch (key) {
    case 'latency_avg': return m.averageLatencyMs;
    case 'latency_p95': return m.p95LatencyMs;
    case 'failure_rate': return m.failureRate;
    case 'success_rate': return m.successRate;
    case 'cost_per_run': return m.estimatedCostPerRun;
    case 'timeout_rate': return m.timeoutRate;
    case 'retry_rate': return m.retryRate;
    default: return null;
  }
}

function buildDelta(current: WorkflowMetrics, baseline: WorkflowMetrics): Record<string, { current: number; baseline: number; change: number }> {
  const keys: Array<{ key: string; metric: keyof WorkflowMetrics }> = [
    { key: 'latency_p95', metric: 'p95LatencyMs' },
    { key: 'latency_avg', metric: 'averageLatencyMs' },
    { key: 'failure_rate', metric: 'failureRate' },
    { key: 'success_rate', metric: 'successRate' },
    { key: 'cost_per_run', metric: 'estimatedCostPerRun' },
    { key: 'timeout_rate', metric: 'timeoutRate' },
  ];

  const delta: Record<string, { current: number; baseline: number; change: number }> = {};
  for (const { key, metric } of keys) {
    const c = current[metric] as number;
    const b = baseline[metric] as number;
    delta[key] = {
      current: c,
      baseline: b,
      change: b === 0 ? 0 : Math.round(((c - b) / b) * 1000) / 1000,
    };
  }
  return delta;
}

function formatKey(key: string): string {
  const map: Record<string, string> = {
    latency_p95: 'P95延迟',
    latency_avg: '平均延迟',
    failure_rate: '失败率',
    success_rate: '成功率',
    cost_per_run: '单次成本',
    timeout_rate: '超时率',
    retry_rate: '重试率',
  };
  return map[key] ?? key;
}

function formatVal(key: string, val: number): string {
  if (key.includes('rate')) return `${val}%`;
  if (key.includes('cost')) return `$${val.toFixed(4)}`;
  if (key.includes('latency')) return `${val}ms`;
  return String(val);
}

// ===== DB Queries =====

async function fetchRuns(workflowId: string, range: string): Promise<RunRecordLike[]> {
  const ms = rangeToMs(range);
  const cutoff = new Date(Date.now() - ms).toISOString();
  const { data } = await supabase
    .from('flow_runs')
    .select('id, status, created_at, duration_ms, retry_count, token_usage, cost, trace')
    .eq('workflow_id', workflowId)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(500);

  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    status: String(r.status),
    created_at: String(r.created_at ?? ''),
    duration_ms: r.duration_ms != null ? Number(r.duration_ms) : null,
    retry_count: r.retry_count != null ? Number(r.retry_count) : null,
    token_usage: (r.token_usage ?? null) as RunRecordLike['token_usage'],
    cost: r.cost != null ? Number(r.cost) : null,
    trace: (r.trace ?? null) as RunRecordLike['trace'],
  }));
}

function rangeToMs(range: string): number {
  switch (range) {
    case '24h': return 24 * 3600 * 1000;
    case '7d': return 7 * 24 * 3600 * 1000;
    case '30d': return 30 * 24 * 3600 * 1000;
    default: return 7 * 24 * 3600 * 1000;
  }
}
