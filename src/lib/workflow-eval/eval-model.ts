/**
 * Evaluation Model（Part 一）
 *
 * 每次 Workflow Run 产生一份 Evaluation，按多个维度分解并**保持可解释**，
 * 不强行压成一个单一分数（避免黑箱打分）。
 *
 * 维度：Correctness / Reliability / Latency / Cost / Token Usage / Failure / Retry / Timeout
 */

import type { RunTrace } from '../tinyflow/runtime/trace';

export interface EvalDimension {
  /** 维度名 */
  name: string;
  /** 0-100 分数 */
  score: number;
  /** 阈值等级：good / warn / bad */
  level: 'good' | 'warn' | 'bad';
  /** 依据（可读） */
  reason: string;
  /** 原始采样值 */
  value?: unknown;
}

export interface RunEvaluation {
  flowId: string;
  status: string;
  dimensions: EvalDimension[];
  /** 关键指标速览 */
  summary: {
    latencyMs: number;
    cost: number;
    totalTokens: number;
    retryCount: number;
    nodeCount: number;
    failedNodes: number;
  };
}

/** 阈值配置（可自定义） */
export interface EvalThresholds {
  /** 最大可接受延迟（ms） */
  latencyMs?: number;
  /** 最大可接受成本（美元） */
  cost?: number;
  /** 失败率上限（0-1） */
  failureRate?: number;
  /** 重试次容忍 */
  retryCount?: number;
}

const DEFAULT_THRESHOLDS: Required<EvalThresholds> = {
  latencyMs: 5000,
  cost: 0.05,
  failureRate: 0.1,
  retryCount: 2,
};

function toScore(factor: number): number {
  // factor: 0..1 表示指标占比（越好越接近 0）；score = 100 - factor*100
  return Math.max(0, Math.min(100, Math.round((1 - factor) * 100)));
}

function percent(n: number, total: number): number {
  return total === 0 ? 0 : n / total;
}

/**
 * 评估一次运行。
 * @param trace 运行 trace（含节点级信息 + tokenUsage）
 * @param status 运行最终状态（completed/failed/timeout/cancelled/paused）
 * @param thresholds 阈值（可覆盖）
 */
export function evaluateRun(
  trace: RunTrace | null,
  status: string,
  thresholds: EvalThresholds = {},
): RunEvaluation {
  const th = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const t = trace ?? {
    flowId: '?',
    workflowId: null,
    version: 1,
    status,
    startedAt: 0,
    finishedAt: 0,
    durationMs: 0,
    retryCount: 0,
    tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    cost: 0,
    nodes: [],
  };
  const dimensions: EvalDimension[] = [];
  const totalNodes = t.nodes.length;
  const failedNodes = t.nodes.filter((n) => n.status === 'failed' || n.status === 'timeout').length;

  // 1. Correctness：成功即满分；失败看失败节点占比
  const ok = status === 'completed';
  const correctnessFactor = ok ? 0 : Math.min(1, percent(failedNodes, Math.max(1, totalNodes)) + 0.5);
  dimensions.push({
    name: 'correctness',
    score: ok ? 100 : toScore(correctnessFactor),
    level: ok ? 'good' : 'bad',
    reason: ok ? '运行成功' : `运行失败/中止（失败节点 ${failedNodes}/${totalNodes}）`,
    value: status,
  });

  // 2. Reliability：失败率/超时率综合
  const failedKind = totalNodes === 0 ? 0 : percent(failedNodes, totalNodes);
  let reliability = 1;
  if (status === 'timeout') reliability = 0.3;
  else if (status !== 'completed') reliability = 0.5;
  else reliability = 1 - failedKind;
  reliability = Math.max(0, reliability - failedKind * 0.5);
  dimensions.push({
    name: 'reliability',
    score: toScore(Math.max(0, Math.min(1, 1 - reliability))),
    level: reliability >= 0.9 ? 'good' : reliability >= 0.6 ? 'warn' : 'bad',
    reason: `状态=${status}，失败节点占比 ${(failedKind * 100).toFixed(1)}%`,
    value: status,
  });

  // 3. Latency
  const latency = t.durationMs;
  const latencyFactor = Math.min(1, latency / th.latencyMs);
  dimensions.push({
    name: 'latency',
    score: toScore(latencyFactor),
    level: latency <= th.latencyMs ? 'good' : latency <= th.latencyMs * 2 ? 'warn' : 'bad',
    reason: `耗时 ${latency}ms${latency > th.latencyMs ? `（阈值 ${th.latencyMs}ms）` : ''}`,
    value: latency,
  });

  // 4. Cost
  const cost = t.cost;
  const costFactor = Math.min(1, cost / th.cost);
  dimensions.push({
    name: 'cost',
    score: toScore(costFactor),
    level: cost <= th.cost ? 'good' : 'bad',
    reason: `成本 $${cost.toFixed(4)}${cost > th.cost ? `（阈值 $${th.cost}）` : ''}`,
    value: cost,
  });

  // 5. Token Usage
  const totalTokens = t.tokenUsage.totalTokens;
  const tokenFactor = Math.min(1, totalTokens / 20000);
  dimensions.push({
    name: 'token_usage',
    score: toScore(tokenFactor) * 0.5 + 50, // token 额度过高给一半权重
    level: totalTokens <= 8000 ? 'good' : totalTokens <= 20000 ? 'warn' : 'bad',
    reason: `token 用量 ${totalTokens}`,
    value: totalTokens,
  });

  // 6. Failure Rate（本次/历史已由指标聚合覆盖；这里给出本 run 的失败占比）
  dimensions.push({
    name: 'failure_rate',
    score: ok ? 100 : toScore(Math.min(1, failedKind * 3)),
    level: ok && failedKind === 0 ? 'good' : 'bad',
    reason: ok ? '无失败' : `${failedNodes} 个节点失败`,
    value: failedKind,
  });

  // 7. Retry Rate
  const retry = t.retryCount;
  const retryFactor = Math.min(1, retry / th.retryCount);
  dimensions.push({
    name: 'retry_rate',
    score: toScore(retryFactor),
    level: retry === 0 ? 'good' : retry <= th.retryCount ? 'warn' : 'bad',
    reason: retry === 0 ? '无重试' : `重试 ${retry} 次`,
    value: retry,
  });

  // 8. Timeout（有无超时节点）
  const timeoutNodes = t.nodes.filter((n) => n.status === 'timeout').length;
  dimensions.push({
    name: 'timeout_rate',
    score: timeoutNodes === 0 ? 100 : 0,
    level: timeoutNodes === 0 ? 'good' : 'bad',
    reason: timeoutNodes === 0 ? '无超时' : `${timeoutNodes} 个节点超时`,
    value: timeoutNodes,
  });

  return {
    flowId: trace?.flowId ?? '?',
    status,
    dimensions,
    summary: {
      latencyMs: t.durationMs,
      cost,
      totalTokens,
      retryCount: retry,
      nodeCount: totalNodes,
      failedNodes,
    },
  };
}

/** 摘要：把 Evaluation 渲染成可读文本 */
export function evalToText(e: RunEvaluation): string {
  const lines = e.dimensions.map((d) => `- ${d.name}: ${d.score}（${d.level}）— ${d.reason}`);
  return `Evaluation [${e.status}]\n${lines.join('\n')}`;
}