/**
 * Skill Runtime
 *
 * Skill Request → Skill Resolver（取已发布工作流版本）→ FlowEngine → Result
 * 复用 Workflow Runtime，不建第二套执行引擎。
 */

import { FlowEngine } from '../tinyflow/engine/FlowEngine';
import type { TinyflowData } from '../tinyflow/types';
import { isConfirmError, isTimeoutError, isCancelledError } from '../tinyflow/runtime/errors';
import type { SkillRunLog } from './skill-types';

export interface RunSkillInput {
  skillId: string;
  skillVersion?: number | null;
  workflowVersion?: number | null;
  inputs: Record<string, unknown>;
  timeoutMs?: number;
  maxConcurrency?: number;
}

export interface RunSkillResult {
  runId: string;
  skillId: string;
  status: SkillRunLog['status'];
  outputs?: Record<string, unknown>;
  error?: string;
  durationMs: number;
  tokenUsage: number;
  estimatedCost: number;
  workflowVersion?: number | null;
  trace?: unknown;
}

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
 * 用 FlowEngine 执行 Skill 绑定的工作流。
 * @param flowData 已解析的工作流（Skill Resolver 负责取发布版本）
 */
export async function executeSkillWorkflow(
  flowData: TinyflowData,
  options: {
    skillId: string;
    skillVersion?: number | null;
    workflowVersion?: number | null;
    inputs?: Record<string, unknown>;
    timeoutMs?: number;
    maxConcurrency?: number;
  },
): Promise<RunSkillResult> {
  const runId = crypto.randomUUID();
  const start = Date.now();

  // 校验输入：仅透传（外层已按 Skill input schema 校验）
  const engine = new FlowEngine(flowData, {
    flowData,
    inputs: options.inputs ?? {},
    timeoutMs: options.timeoutMs ?? 60_000,
    maxConcurrency: options.maxConcurrency ?? 1,
  });

  try {
    await engine.run();
    const outputs = extractFinalOutputs(flowData, engine);
    const trace = engine.getTrace();
    return {
      runId,
      skillId: options.skillId,
      status: 'completed',
      outputs,
      durationMs: Date.now() - start,
      tokenUsage: trace.tokenUsage.totalTokens,
      estimatedCost: trace.cost,
      workflowVersion: options.workflowVersion,
      trace,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    if (isConfirmError(err)) {
      return { runId, skillId: options.skillId, status: 'completed', outputs: {}, durationMs, tokenUsage: 0, estimatedCost: 0, workflowVersion: options.workflowVersion };
    }
    if (isTimeoutError(err) || engine.getState() === 'timeout') {
      return { runId, skillId: options.skillId, status: 'timeout', error: (err as Error).message, durationMs, tokenUsage: 0, estimatedCost: 0, workflowVersion: options.workflowVersion };
    }
    if (isCancelledError(err) || engine.getState() === 'cancelled') {
      return { runId, skillId: options.skillId, status: 'cancelled', error: (err as Error).message, durationMs, tokenUsage: 0, estimatedCost: 0, workflowVersion: options.workflowVersion };
    }
    return { runId, skillId: options.skillId, status: 'failed', error: (err as Error).message, durationMs, tokenUsage: 0, estimatedCost: 0, workflowVersion: options.workflowVersion };
  }
}

/** 构造一条可落库的 SkillRunLog */
export function toSkillRunLog(result: RunSkillResult, extra: { skillVersion?: number | null; inputs?: Record<string, unknown>; rateLimited?: boolean }): SkillRunLog {
  return {
    runId: result.runId,
    skillId: result.skillId,
    skillVersion: extra.skillVersion ?? null,
    workflowVersion: result.workflowVersion ?? null,
    inputs: extra.inputs ?? {},
    status: result.status,
    outputs: result.outputs,
    error: result.error,
    durationMs: result.durationMs,
    tokenUsage: result.tokenUsage,
    estimatedCost: result.estimatedCost,
    rateLimited: extra.rateLimited,
    ranAt: new Date().toISOString(),
  };
}
