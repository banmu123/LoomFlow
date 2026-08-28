/**
 * Evolution History — Outcome Calculator
 *
 * 计算 Evolution 的 before/after metrics。
 *
 * 语义：
 *   - before: 来自 evolution event 的 regression baseline snapshot
 *   - after: 版本应用之后观察到的运行指标（observed_after_version）
 *
 * 注意：
 *   - flow_runs 没有 version 字段，无法严格证明 after runs 由新版本产生
 *   - after 使用 "observed_after_version" 而非 "version_scoped"
 *   - 如果观察窗口内 runs < minimumSamples，after = null
 *
 * Read Model：不写入任何数据。
 */

import { supabase } from '@/lib/supabase/server';
import { aggregateWorkflowMetrics } from '../workflow-eval/metrics';
import { toMetricSnapshot, type MetricSnapshot, ALL_METRIC_NAMES, type MetricName } from '../workflow-eval/regression-policy';
import type { RunRecordLike } from '../workflow-eval/metrics';

// ===== Types =====

export type OutcomeSource = 'observed_after_version' | 'unavailable';

export interface MetricDelta {
  before: number;
  after: number | null;
  change: number | null; // relativeDelta, null if after is null
}

export interface EvolutionOutcome {
  source: OutcomeSource;
  before: MetricSnapshot;
  after: MetricSnapshot | null;
  delta: Record<MetricName, MetricDelta>;
}

// ===== Constants =====

const DEFAULT_MIN_SAMPLES = 5;

// ===== Calculator =====

/**
 * 计算 Evolution Outcome。
 *
 * @param beforeMetrics - regression baseline snapshot（来自 event.metric_snapshot.baseline）
 * @param workflowId - 工作流 ID
 * @param versionCreatedAt - 新版本的 created_at（观察窗口起点）
 * @param userId - 用户 ID
 * @param minimumSamples - after metrics 最小样本数
 */
export async function calculateOutcome(
  beforeMetrics: MetricSnapshot,
  workflowId: string,
  versionCreatedAt: string,
  userId: string,
  minimumSamples: number = DEFAULT_MIN_SAMPLES,
): Promise<EvolutionOutcome> {
  // 获取版本应用后的 runs
  const afterRuns = await fetchRunsAfter(workflowId, userId, versionCreatedAt);

  const delta = buildDeltaSkeleton(beforeMetrics);

  if (afterRuns.length < minimumSamples) {
    return {
      source: afterRuns.length === 0 ? 'unavailable' : 'observed_after_version',
      before: beforeMetrics,
      after: null,
      delta,
    };
  }

  const afterMetrics = buildSnapshot(afterRuns);

  // 计算 delta
  for (const name of ALL_METRIC_NAMES) {
    const beforeVal = beforeMetrics[name];
    const afterVal = afterMetrics[name];
    delta[name] = {
      before: beforeVal,
      after: afterVal,
      change: beforeVal === 0 ? null : (afterVal - beforeVal) / beforeVal,
    };
  }

  return {
    source: 'observed_after_version',
    before: beforeMetrics,
    after: afterMetrics,
    delta,
  };
}

/**
 * 构建 unavailable outcome（无版本信息时）。
 */
export function buildUnavailableOutcome(beforeMetrics: MetricSnapshot): EvolutionOutcome {
  return {
    source: 'unavailable',
    before: beforeMetrics,
    after: null,
    delta: buildDeltaSkeleton(beforeMetrics),
  };
}

// ===== Internal Helpers =====

function buildDeltaSkeleton(beforeMetrics: MetricSnapshot): Record<MetricName, MetricDelta> {
  const delta = {} as Record<MetricName, MetricDelta>;
  for (const name of ALL_METRIC_NAMES) {
    delta[name] = { before: beforeMetrics[name], after: null, change: null };
  }
  return delta;
}

function buildSnapshot(runs: RunRecordLike[]): MetricSnapshot {
  const m = aggregateWorkflowMetrics(runs);
  return toMetricSnapshot(m);
}

async function fetchRunsAfter(
  workflowId: string,
  userId: string,
  afterTime: string,
): Promise<RunRecordLike[]> {
  const { data } = await supabase
    .from('flow_runs')
    .select('id, workflow_id, status, created_at, duration_ms, retry_count, token_usage, cost, trace, error')
    .eq('workflow_id', workflowId)
    .eq('user_id', userId)
    .gt('created_at', afterTime)
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
