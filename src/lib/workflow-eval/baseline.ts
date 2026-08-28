/**
 * Baseline Manager — Regression Detection Phase 2
 *
 * 为 Regression Detection 提供统一的 Baseline。
 * 支持三种类型：version / production / rolling。
 *
 * 复用：
 *   - workflow-eval/store.ts    (listWorkflowRuns, getWorkflowVersionData)
 *   - workflow-eval/metrics.ts  (aggregateWorkflowMetrics, filterRunsByRange)
 *   - regression-policy.ts     (MetricSnapshot, toMetricSnapshot)
 *
 * 不含：regression 判定 / severity / AI / proposal / event。
 */

import { supabase } from '@/lib/supabase/server';
import type { EvalRange, RunRecordLike } from './metrics';
import { aggregateWorkflowMetrics, filterRunsByRange } from './metrics';
import { toMetricSnapshot, type MetricSnapshot } from './regression-policy';

// ===== Types =====

export type BaselineType = 'version' | 'production' | 'rolling';
export type BaselineStatus = 'ready' | 'insufficient' | 'unavailable';

export interface Baseline {
  workflowId: string;
  type: BaselineType;
  /** version 类型时有值 */
  version?: number;
  /** rolling 类型时有值（如 '7d'） */
  timeRange?: string;
  /** 可用样本数（version=1 表示快照；production/rolling=运行次数） */
  sampleCount: number;
  status: BaselineStatus;
  /** 指标快照（复用 Phase 1 的 MetricSnapshot） */
  metrics: MetricSnapshot;
  /** 数据来源描述 */
  source: string;
  generatedAt: string;
}

export interface BaselineOptions {
  minimumSamples?: number;
}

const DEFAULT_MIN_SAMPLES = 20;

// ===== Version Baseline =====

/**
 * Version Baseline：获取指定版本的快照指标。
 *
 * 数据来源：workflow_versions 表的版本快照（{ nodes, edges }）。
 * 注意：flow_runs 无 version 字段，无法获取"某版本的运行指标"。
 * Version Baseline 的 sampleCount=1 表示"1 个版本快照"。
 */
export async function getVersionBaseline(
  workflowId: string,
  version: number,
  options?: BaselineOptions,
): Promise<Baseline> {
  const minSamples = options?.minimumSamples ?? DEFAULT_MIN_SAMPLES;

  // 检查版本是否存在
  const { data, error } = await supabase
    .from('workflow_versions')
    .select('data, created_at')
    .eq('workflow_id', workflowId)
    .eq('version', version)
    .maybeSingle();

  if (error) throw new Error(`数据库查询失败: ${error.message}`);

  if (!data) {
    return makeBaseline({
      workflowId,
      type: 'version',
      version,
      sampleCount: 0,
      status: 'unavailable',
      metrics: EMPTY_SNAPSHOT,
      source: `版本 v${version} 不存在`,
    });
  }

  // 版本快照存在：sampleCount=1（快照，非运行次数）
  // 快照无运行指标，使用空指标（successRate=100, failureRate=0, p95=0, cost=0, testScore=100）
  // Regression Detector 对 sampleCount=1 的 baseline 可以特殊处理
  const snapshot = toMetricSnapshot({
    successRate: 100,
    failureRate: 0,
    p95LatencyMs: 0,
    estimatedCostPerRun: 0,
  });

  return makeBaseline({
    workflowId,
    type: 'version',
    version,
    sampleCount: 1,
    status: 1 >= minSamples ? 'ready' : 'insufficient',
    metrics: snapshot,
    source: `版本 v${version} 快照（无运行指标）`,
  });
}

// ===== Production Baseline =====

/**
 * Production Baseline：获取当前生产版本的运行指标。
 *
 * 数据来源：flow_runs 全量聚合（不区分版本）。
 * 如果 workflow 已发布（published=true），使用 published_version 标识。
 */
export async function getProductionBaseline(
  workflowId: string,
  userId: string,
  options?: BaselineOptions,
): Promise<Baseline> {
  const minSamples = options?.minimumSamples ?? DEFAULT_MIN_SAMPLES;

  // 获取全量 runs
  const runs = await fetchRuns(workflowId, userId);

  if (runs.length === 0) {
    return makeBaseline({
      workflowId,
      type: 'production',
      sampleCount: 0,
      status: 'unavailable',
      metrics: EMPTY_SNAPSHOT,
      source: '无执行记录',
    });
  }

  if (runs.length < minSamples) {
    const metrics = buildSnapshot(runs);
    return makeBaseline({
      workflowId,
      type: 'production',
      sampleCount: runs.length,
      status: 'insufficient',
      metrics,
      source: `仅 ${runs.length} 次执行，需至少 ${minSamples} 次`,
    });
  }

  const metrics = buildSnapshot(runs);
  return makeBaseline({
    workflowId,
    type: 'production',
    sampleCount: runs.length,
    status: 'ready',
    metrics,
    source: `${runs.length} 次执行聚合`,
  });
}

// ===== Rolling Baseline =====

/**
 * Rolling Baseline：获取指定时间窗口的运行指标。
 *
 * 数据来源：flow_runs + filterRunsByRange()。
 * 复用现有 EvalRange 类型和时间过滤逻辑。
 */
export async function getRollingBaseline(
  workflowId: string,
  userId: string,
  range: EvalRange,
  options?: BaselineOptions,
): Promise<Baseline> {
  const minSamples = options?.minimumSamples ?? DEFAULT_MIN_SAMPLES;

  const allRuns = await fetchRuns(workflowId, userId);
  const runs = filterRunsByRange(allRuns, range);

  if (runs.length === 0) {
    return makeBaseline({
      workflowId,
      type: 'rolling',
      timeRange: range,
      sampleCount: 0,
      status: 'unavailable',
      metrics: EMPTY_SNAPSHOT,
      source: `${range} 内无执行记录`,
    });
  }

  if (runs.length < minSamples) {
    const metrics = buildSnapshot(runs);
    return makeBaseline({
      workflowId,
      type: 'rolling',
      timeRange: range,
      sampleCount: runs.length,
      status: 'insufficient',
      metrics,
      source: `${range} 内仅 ${runs.length} 次执行，需至少 ${minSamples} 次`,
    });
  }

  const metrics = buildSnapshot(runs);
  return makeBaseline({
    workflowId,
    type: 'rolling',
    timeRange: range,
    sampleCount: runs.length,
    status: 'ready',
    metrics,
    source: `${range} 内 ${runs.length} 次执行聚合`,
  });
}

// ===== Internal Helpers =====

/** 空指标（无数据时使用） */
const EMPTY_SNAPSHOT: MetricSnapshot = {
  successRate: 100,
  failureRate: 0,
  p95Latency: 0,
  costPerRun: 0,
  testScore: 100,
};

/** 从 runs 构建 MetricSnapshot（复用 metrics.ts，不重新实现） */
function buildSnapshot(runs: RunRecordLike[]): MetricSnapshot {
  const m = aggregateWorkflowMetrics(runs);
  return toMetricSnapshot(m);
}

/** 构建 Baseline 对象 */
function makeBaseline(params: {
  workflowId: string;
  type: BaselineType;
  version?: number;
  timeRange?: string;
  sampleCount: number;
  status: BaselineStatus;
  metrics: MetricSnapshot;
  source: string;
}): Baseline {
  return {
    workflowId: params.workflowId,
    type: params.type,
    version: params.version,
    timeRange: params.timeRange,
    sampleCount: params.sampleCount,
    status: params.status,
    metrics: params.metrics,
    source: params.source,
    generatedAt: new Date().toISOString(),
  };
}

/** 获取工作流的执行记录（复用 store.ts 的查询模式） */
async function fetchRuns(workflowId: string, userId: string): Promise<RunRecordLike[]> {
  const { data, error } = await supabase
    .from('flow_runs')
    .select('id, workflow_id, status, created_at, duration_ms, retry_count, token_usage, cost, trace, error')
    .eq('workflow_id', workflowId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(500);

  if (error || !data) return [];
  return ((data ?? []) as Array<Record<string, unknown>>).map(rowToRun);
}

/** 行记录转 RunRecordLike（与 store.ts 保持一致） */
function rowToRun(r: Record<string, unknown>): RunRecordLike {
  return {
    id: String(r.id),
    status: String(r.status),
    created_at: String(r.created_at ?? ''),
    duration_ms: r.duration_ms != null ? Number(r.duration_ms) : null,
    retry_count: r.retry_count != null ? Number(r.retry_count) : null,
    token_usage: (r.token_usage ?? null) as RunRecordLike['token_usage'],
    cost: r.cost != null ? Number(r.cost) : null,
    trace: (r.trace ?? null) as RunRecordLike['trace'],
  };
}
