/**
 * Workflow Metrics / Node Metrics 聚合（Part 二 / 三）
 *
 * 输入：run 历史记录列表（来自 flow_runs 或 skill_runs）
 * 输出：Workflow 级聚合指标 + Node 级聚合指标（纯函数，可测）
 */

import type { NodeTrace, RunTrace } from '../tinyflow/runtime/trace';
import type { ModelPrice } from './pricing';

export interface RunRecordLike {
  id: string;
  status: string;
  created_at?: string;
  duration_ms?: number | null;
  retry_count?: number | null;
  token_usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null;
  cost?: number | null;
  trace?: RunTrace | null;
}

export type EvalRange = '24h' | '7d' | '30d';

export function rangeToMs(range: EvalRange): number {
  switch (range) {
    case '24h': return 24 * 3600 * 1000;
    case '7d': return 7 * 24 * 3600 * 1000;
    case '30d':
    default:
      return 30 * 24 * 3600 * 1000;
  }
}

/** 按时间范围过滤 run 记录 */
export function filterRunsByRange(runs: RunRecordLike[], range: EvalRange, now = Date.now()): RunRecordLike[] {
  const cutoff = now - rangeToMs(range);
  return runs.filter((r) => {
    if (!r.created_at) return true;
    const t = new Date(r.created_at).getTime();
    if (Number.isNaN(t)) return true;
    return t >= cutoff;
  });
}

export interface WorkflowMetrics {
  totalRuns: number;
  successRate: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  averageTokenUsage: number;
  estimatedCostPerRun: number;
  totalEstimatedCost: number;
  failureRate: number;
  retryRate: number;
  timeoutRate: number;
  runs: { status: string; at: string }[];
}

export interface NodeMetrics {
  nodeId: string;
  type: string;
  title: string;
  executionCount: number;
  averageDurationMs: number;
  p95DurationMs: number;
  failureRate: number;
  retryCount: number;
  averageTokenUsage: number;
  estimatedCost: number;
  /** 最近一次状态 */
  lastStatus?: string;
}

export interface NodeMetricsResult {
  nodes: NodeMetrics[];
  slowest: NodeMetrics | null;
  mostExpensive: NodeMetrics | null;
  mostFailureProne: NodeMetrics | null;
}

function p95Sorted(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx];
}
function avg(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const isSuccess = (s: string) => s === 'completed' || s === 'success';
const isFailure = (s: string) => s === 'failed';
const isTimeout = (s: string) => s === 'timeout';

export function aggregateWorkflowMetrics(runs: RunRecordLike[]): WorkflowMetrics {
  const n = runs.length;
  const durations = runs.map((r) => Number(r.duration_ms ?? 0)).filter((v) => v > 0);
  const tokens = runs.map((r) => Number(r.token_usage?.totalTokens ?? 0));
  const costs = runs.map((r) => Number(r.cost ?? 0));
  const success = runs.filter((r) => isSuccess(r.status)).length;
  const failed = runs.filter((r) => isFailure(r.status)).length;
  const timeout = runs.filter((r) => isTimeout(r.status)).length;
  const retried = runs.reduce((sum, r) => sum + Number(r.retry_count ?? 0), 0);

  const successRate = n === 0 ? 100 : (success / n) * 100;
  return {
    totalRuns: n,
    successRate: Math.round(successRate * 10) / 10,
    averageLatencyMs: Math.round(avg(durations)),
    p95LatencyMs: Math.round(p95Sorted([...durations].sort((a, b) => a - b))),
    averageTokenUsage: Math.round(avg(tokens)),
    estimatedCostPerRun: Math.round(avg(costs) * 10000) / 10000,
    totalEstimatedCost: Math.round(costs.reduce((a, b) => a + b, 0) * 10000) / 10000,
    failureRate: Math.round((n === 0 ? 0 : (failed / n) * 100) * 10) / 10,
    retryRate: n === 0 ? 0 : Math.round((retried / n) * 10) / 10,
    timeoutRate: Math.round((n === 0 ? 0 : (timeout / n) * 100) * 10) / 10,
    runs: runs.map((r) => ({ status: r.status, at: r.created_at ?? '' })),
  };
}

/** 从每一条 run 的 trace.nodes 聚合节点指标 */
export function aggregateNodeMetrics(runs: RunRecordLike[], price?: ModelPrice): NodeMetricsResult {
  const byNode = new Map<string, {
    nodeId: string; type: string; title: string;
    durations: number[];
    execCount: number;
    failed: number;
    timeoutCount: number;
    retried: number;
    tokens: number[];
    statuses: string[];
  }>();

  for (const run of runs) {
    const trace = run.trace;
    if (!trace?.nodes?.length) continue;
    for (const nt of trace.nodes) {
      const key = nt.nodeId;
      let agg = byNode.get(key);
      if (!agg) {
        agg = { nodeId: nt.nodeId, type: nt.type, title: nt.title, durations: [], execCount: 0, failed: 0, timeoutCount: 0, retried: 0, tokens: [], statuses: [] };
        byNode.set(key, agg);
      }
      agg.execCount += 1;
      agg.durations.push(nt.durationMs);
      if (nt.status === 'failed') agg.failed += 1;
      if (nt.status === 'timeout') agg.timeoutCount += 1;
      agg.retried += nt.retryCount ?? 0;
      const tok = extractTokens(nt);
      agg.tokens.push(tok);
      agg.statuses.push(nt.status);
    }
  }

  const nodes: NodeMetrics[] = [...byNode.values()].map((a) => {
    const failureRate = a.execCount === 0 ? 0 : ((a.failed + a.timeoutCount) / a.execCount) * 100;
    const avgTokens = avg(a.tokens);
    const cost = price
      ? (avgTokens / 1000) * price.inputPer1K * 0.66 + (avgTokens / 1000) * price.outputPer1K * 0.34
      : 0; // 仅按 LLM 节点粗估；非 LLM 节点 cost 为 0
    return {
      nodeId: a.nodeId,
      type: a.type,
      title: a.title,
      executionCount: a.execCount,
      averageDurationMs: Math.round(avg(a.durations)),
      p95DurationMs: Math.round(p95Sorted([...a.durations].sort((x, y) => x - y))),
      failureRate: Math.round(failureRate * 10) / 10,
      retryCount: a.retried,
      averageTokenUsage: Math.round(avgTokens),
      estimatedCost: Math.round(cost * 100000) / 100000,
      lastStatus: a.statuses[a.statuses.length - 1],
    };
  });

  const sortedByDuration = [...nodes].sort((a, b) => b.averageDurationMs - a.averageDurationMs);
  const sortedByCost = [...nodes].sort((a, b) => b.estimatedCost - a.estimatedCost);
  const sortedByFailure = [...nodes].sort((a, b) => b.failureRate - a.failureRate);

  return {
    nodes,
    slowest: sortedByDuration[0] && sortedByDuration[0].averageDurationMs > 0 ? sortedByDuration[0] : null,
    mostExpensive: sortedByCost[0] && sortedByCost[0].estimatedCost > 0 ? sortedByCost[0] : null,
    mostFailureProne: sortedByFailure[0] && sortedByFailure[0].failureRate > 0 ? sortedByFailure[0] : null,
  };
}

function extractTokens(nt: NodeTrace): number {
  // trace 节点没有 token 字段时，从 output.tokens 回退（LLM 节点常规给 tokens）
  const out = nt.output as Record<string, unknown> | undefined;
  const raw = out?.tokens ?? out?.usage;
  if (raw && typeof raw === 'object') {
    return Number((raw as { totalTokens?: number }).totalTokens ?? 0);
  }
  return Number(raw ?? 0) || 0;
}

/** 内部辅助（测试用） */
export function _p95(sorted: number[]): number {
  return p95Sorted(sorted);
}
export function _avg(arr: number[]): number {
  return avg(arr);
}
export function _median(arr: number[]): number {
  return median(arr);
}