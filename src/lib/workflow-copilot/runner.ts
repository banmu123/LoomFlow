/**
 * 纯执行 Runner（供测试运行 / patch 验证使用）
 *
 * 直接使用 FlowEngine 执行工作流，捕获最终输出与状态——
 * 不落库 flow_runs（避免污染执行历史），返回可被 evaluation 消费的结果。
 */

import { FlowEngine } from '../tinyflow/engine/FlowEngine';
import type { TinyflowData } from '../tinyflow/types';
import { isConfirmError, isCancelledError, isTimeoutError } from '../tinyflow/runtime/errors';

export interface RunnerResult {
  status: 'completed' | 'failed' | 'cancelled' | 'timeout' | 'paused';
  outputs: Record<string, unknown>;
  error?: string;
  durationMs: number;
}

/** 提取最终输出（复用 runFlow 逻辑，但避免依赖 supabase） */
function extractFinalOutputs(flowData: TinyflowData, engine: FlowEngine): Record<string, unknown> {
  const endNode = flowData.nodes.find((n) => n.type === 'endNode');
  if (endNode) {
    const endOutputs = engine.getContext().nodeOutputs.get(endNode.id);
    if (endOutputs && Object.keys(endOutputs).length > 0) return endOutputs;
  }
  const summary: Record<string, unknown> = {};
  for (const [nodeId, outputs] of engine.getContext().nodeOutputs) {
    if (outputs && typeof outputs === 'object' && Object.keys(outputs).length > 0) {
      const nodeType = flowData.nodes.find((n) => n.id === nodeId)?.type;
      if (nodeType === 'startNode' || nodeType === 'endNode') continue;
      summary[nodeId] = outputs;
    }
  }
  return summary;
}

/**
 * 运行一个工作流并返回结果。
 * @param timeoutMs 工作流级超时（默认 30s，测试用）
 * @param maxConcurrency 并发（默认 1）
 */
export async function runWorkflow(
  flowData: TinyflowData,
  inputs: Record<string, unknown>,
  options: { timeoutMs?: number; maxConcurrency?: number; defaultNodeTimeoutMs?: number } = {},
): Promise<RunnerResult> {
  const start = Date.now();
  const engine = new FlowEngine(flowData, {
    flowData,
    inputs,
    timeoutMs: options.timeoutMs ?? 30_000,
    defaultNodeTimeoutMs: options.defaultNodeTimeoutMs,
    maxConcurrency: options.maxConcurrency ?? 1,
  });

  try {
    await engine.run();
    return {
      status: 'completed',
      outputs: extractFinalOutputs(flowData, engine),
      durationMs: Date.now() - start,
    };
  } catch (err) {
    if (isConfirmError(err)) {
      return { status: 'paused', outputs: {}, durationMs: Date.now() - start };
    }
    if (isTimeoutError(err) || engine.getState() === 'timeout') {
      return { status: 'timeout', outputs: {}, error: (err as Error).message, durationMs: Date.now() - start };
    }
    if (isCancelledError(err) || engine.getState() === 'cancelled') {
      return { status: 'cancelled', outputs: {}, error: (err as Error).message, durationMs: Date.now() - start };
    }
    return { status: 'failed', outputs: {}, error: (err as Error).message, durationMs: Date.now() - start };
  }
}
