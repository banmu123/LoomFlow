/**
 * Bottleneck Detection（Part 四）
 *
 * 基于 Node Metrics 自动定位：最慢节点 / 最贵节点 / 最易失败节点，
 * 并给出可读的瓶颈报告与优化提示。
 */

import type { NodeMetrics, WorkflowMetrics } from './metrics';

export interface Bottleneck {
  kind: 'latency' | 'cost' | 'failure';
  nodeId: string;
  title: string;
  value: string;
  sharePercent?: number;
  suggestion: string;
}

export interface BottleneckReport {
  bottlenecks: Bottleneck[];
  summary: string;
}

/** 判定：某节点是否为主要延迟瓶颈（占比高或绝对耗时高） */
export function detectBottlenecks(
  workflow: WorkflowMetrics,
  nodes: NodeMetrics[],
): BottleneckReport {
  const bottlenecks: Bottleneck[] = [];
  const n = nodes.length;
  const totalDuration = nodes.reduce((sum, x) => sum + x.averageDurationMs, 0);

  // 延迟瓶颈
  if (nodes.length > 0) {
    const sorted = [...nodes].sort((a, b) => b.averageDurationMs - a.averageDurationMs);
    for (const nodeMeta of sorted.slice(0, Math.min(3, n))) {
      if (nodeMeta.averageDurationMs <= 0) continue;
      const share = totalDuration > 0 ? (nodeMeta.averageDurationMs / totalDuration) * 100 : 0;
      if (share >= 25 || nodeMeta.averageDurationMs >= 1500) {
        bottlenecks.push({
          kind: 'latency',
          nodeId: nodeMeta.nodeId,
          title: nodeMeta.title,
          value: `${nodeMeta.averageDurationMs}ms（占比 ${share.toFixed(0)}%）`,
          sharePercent: Math.round(share),
          suggestion: `「${nodeMeta.title}」是主要延迟瓶颈，考虑并行化其上游节点或优化实现`,
        });
      }
    }
  }

  // 成本瓶颈
  const sortedCost = [...nodes].sort((a, b) => b.estimatedCost - a.estimatedCost);
  for (const nodeMeta of sortedCost.slice(0, 2)) {
    if (nodeMeta.estimatedCost <= 0) continue;
    const share = workflow.totalEstimatedCost > 0
      ? (nodeMeta.estimatedCost / workflow.totalEstimatedCost) * 100
      : 0;
    bottlenecks.push({
      kind: 'cost',
      nodeId: nodeMeta.nodeId,
      title: nodeMeta.title,
      value: `$${(nodeMeta.estimatedCost * workflow.totalRuns).toFixed(4)} / ${workflow.totalRuns} runs`,
      sharePercent: Math.round(share),
      suggestion: `「${nodeMeta.title}」token 消耗高，考虑换更便宜的模型或精简提示词`,
    });
  }

  // 失败瓶颈
  const sortedFail = [...nodes].sort((a, b) => b.failureRate - a.failureRate);
  for (const nodeMeta of sortedFail.slice(0, 2)) {
    if (nodeMeta.failureRate <= 0) continue;
    bottlenecks.push({
      kind: 'failure',
      nodeId: nodeMeta.nodeId,
      title: nodeMeta.title,
      value: `失败率 ${nodeMeta.failureRate}%`,
      suggestion: `「${nodeMeta.title}」失败率偏高，检查节点配置 / 重试策略，或补充错误处理`,
    });
  }

  const summary = bottlenecks.length === 0
    ? '未发现明显瓶颈。'
    : `发现 ${bottlenecks.length} 处瓶颈：${bottlenecks.map((b) => `${b.title}(${b.value})`).join('、')}。`;

  return { bottlenecks, summary };
}