import type { NodeStatus } from '../types';
import { toErrorMessage } from './errors';

export interface NodeAttemptTrace {
  attempt: number;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  error?: string;
}

export interface NodeTrace {
  nodeId: string;
  type: string;
  title: string;
  status: NodeStatus;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  attempts: NodeAttemptTrace[];
  input?: unknown;
  output?: unknown;
  error?: string;
  /** 重试次数（不含首次） */
  retryCount: number;
}

export interface RunTrace {
  flowId: string;
  workflowId?: string | null;
  version: number;
  status: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  retryCount: number;
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
  cost: number;
  nodes: NodeTrace[];
}

export function createRunTrace(flowId: string): RunTrace {
  return {
    flowId,
    workflowId: null,
    version: 1,
    status: 'running',
    startedAt: Date.now(),
    finishedAt: 0,
    durationMs: 0,
    retryCount: 0,
    tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    cost: 0,
    nodes: [],
  };
}

/** 从节点输出中提取 token 用量（LLM 节点返回 { tokens } 或 { usage }） */
export function extractTokenUsage(outputs: Record<string, unknown>): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  const usage = outputs.tokens ?? outputs.usage;
  if (usage && typeof usage === 'object') {
    const u = usage as { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    const promptTokens = Number(u.promptTokens ?? 0);
    const completionTokens = Number(u.completionTokens ?? 0);
    return {
      promptTokens,
      completionTokens,
      totalTokens: Number(u.totalTokens ?? promptTokens + completionTokens),
    };
  }
  const total = Number(usage ?? 0);
  if (total > 0) return { promptTokens: 0, completionTokens: 0, totalTokens: total };
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

/**
 * 简单成本估算（按 token 单价，美元）。无定价表时返回 0。
 * 预留扩展：后续接模型定价配置。
 */
const PRICE_PER_1K: Record<string, number> = {
  prompt: 0.002,
  completion: 0.006,
};

export function estimateCost(usage: RunTrace['tokenUsage']): number {
  return (
    (usage.promptTokens / 1000) * PRICE_PER_1K.prompt +
    (usage.completionTokens / 1000) * PRICE_PER_1K.completion
  );
}

export function finalizeRunTrace(
  trace: RunTrace,
  status: string,
  workflowId?: string | null,
): RunTrace {
  trace.status = status;
  trace.workflowId = workflowId ?? null;
  trace.finishedAt = Date.now();
  trace.durationMs = trace.finishedAt - trace.startedAt;
  trace.cost = estimateCost(trace.tokenUsage);
  trace.retryCount = trace.nodes.reduce((sum, n) => sum + n.retryCount, 0);
  return trace;
}

export function nodeErrorToMessage(err: unknown): string {
  return toErrorMessage(err);
}
