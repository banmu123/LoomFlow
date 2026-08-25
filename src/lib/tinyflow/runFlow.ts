import { FlowEngine, flowRunStore } from './index';
import type { TinyflowData, FlowError } from './types';
import { supabase } from '@/lib/supabase/server';
import {
  idempotencyStore,
  IdempotentResult,
  redactForTrace,
  serializeCheckpoint,
  CheckpointData,
  runStateToPersistedStatus,
  isConfirmError,
  isCancelledError,
  isTimeoutError,
} from './runtime';

export interface RunFlowResult {
  flowId: string;
  status: 'running' | 'completed' | 'paused' | 'failed' | 'cancelled' | 'timeout';
  outputs?: Record<string, unknown>;
  events?: Array<{ type: string; data: unknown; timestamp: number }>;
  confirmRequest?: unknown;
  error?: string;
  duplicate?: boolean;
  /** 已脱敏的 trace（observability；敏感字段隐藏） */
  trace?: unknown;
}

export interface RunFlowOptions {
  source?: 'internal' | 'api';
  workflowId?: string | null;
  userId?: string | null;
  /** 幂等键：相同 key 的重复请求直接返回首次结果 */
  idempotencyKey?: string;
  /** 工作流级超时（ms） */
  timeoutMs?: number;
  /** 并发上限（依赖允许时生效） */
  maxConcurrency?: number;
  /** 外部取消信号（HTTP 连接断开 / 用户取消） */
  signal?: AbortSignal;
}

// 提取最终输出：endNode 配置了输出引用时用 endNode 结果；
// 否则回退汇总所有已完成节点的输出（保证外部调用总能拿到结果）
export function extractFinalOutputs(
  flowData: TinyflowData,
  engine: FlowEngine,
): Record<string, unknown> {
  const endNode = flowData.nodes.find((n) => n.type === 'endNode');
  if (endNode) {
    const endOutputs = engine.getContext().nodeOutputs.get(endNode.id);
    if (endOutputs && Object.keys(endOutputs).length > 0) {
      return endOutputs;
    }
  }

  // 回退：汇总所有有输出的节点（跳过 start/end 的空输出）
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

export type SaveFlowRunData = {
  workflowId?: string | null;
  userId?: string | null;
  source?: 'internal' | 'api';
  status?: string;
  inputs?: Record<string, unknown> | null;
  outputs?: Record<string, unknown> | null;
  events?: Array<{ type: string; data: unknown; timestamp: number }> | null;
  error?: string | null;
  flowData?: unknown | null;
  startTime?: number;
  finishTime?: number;
  /** 节点级 trace（Evaluation/Optimization 数据源） */
  trace?: unknown;
  tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null;
  cost?: number;
  retryCount?: number;
};

/** run trace → 落库用的 token_usage 摘要 */
export function traceToTokenUsage(trace: unknown): { promptTokens: number; completionTokens: number; totalTokens: number } {
  const t = (trace ?? {}) as { tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } };
  return {
    promptTokens: Number(t.tokenUsage?.promptTokens ?? 0),
    completionTokens: Number(t.tokenUsage?.completionTokens ?? 0),
    totalTokens: Number(t.tokenUsage?.totalTokens ?? 0),
  };
}

// 写入/更新执行记录（落库持久化）
export async function saveFlowRun(
  flowId: string,
  data: SaveFlowRunData,
): Promise<void> {
  try {
    const exists = await supabase.from('flow_runs').select('id').eq('id', flowId).maybeSingle();
    const row = {
      workflow_id: data.workflowId ?? null,
      user_id: data.userId ?? null,
      source: data.source ?? 'internal',
      status: data.status ?? 'running',
      inputs: data.inputs ?? null,
      outputs: data.outputs ?? null,
      events: data.events ?? null,
      error: data.error ?? null,
      flow_data: data.flowData ?? null,
      trace: data.trace ?? null,
      token_usage: data.tokenUsage ?? null,
      cost: data.cost ?? null,
      retry_count: data.retryCount ?? null,
      duration_ms: data.startTime && data.finishTime ? Math.max(0, data.finishTime - data.startTime) : null,
    };

    if (exists.data) {
      // 更新分支只补传入的字段——否则第二次调用（completed）会把
      // 首次写入的 inputs/workflow_id/user_id/source 覆盖成 null
      const patch: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (data.workflowId !== undefined) patch.workflow_id = data.workflowId;
      if (data.userId !== undefined) patch.user_id = data.userId;
      if (data.source !== undefined) patch.source = data.source;
      if (data.status !== undefined) patch.status = data.status;
      if (data.inputs !== undefined) patch.inputs = data.inputs;
      if (data.outputs !== undefined) patch.outputs = data.outputs;
      if (data.events !== undefined) patch.events = data.events;
      if (data.error !== undefined) patch.error = data.error;
      if (data.flowData !== undefined) patch.flow_data = data.flowData;
      if (data.startTime !== undefined) patch.started_at = new Date(data.startTime).toISOString();
      if (data.finishTime !== undefined) {
        patch.finished_at = new Date(data.finishTime).toISOString();
        patch.duration_ms = Math.max(0, data.finishTime - (data.startTime ?? Date.now()));
      }
      if (data.trace !== undefined) patch.trace = data.trace;
      if (data.tokenUsage !== undefined) patch.token_usage = data.tokenUsage;
      if (data.cost !== undefined) patch.cost = data.cost;
      if (data.retryCount !== undefined) patch.retry_count = data.retryCount;
      await supabase.from('flow_runs').update(patch).eq('id', flowId);
    } else {
      await supabase.from('flow_runs').insert({ id: flowId, ...row });
    }
  } catch {
    // 落库失败不影响执行
  }
}

/** 持久化 checkpoint 到 flow_runs（供服务重启/异常恢复） */
export async function persistCheckpoint(flowId: string, checkpoint: CheckpointData): Promise<void> {
  try {
    await supabase
      .from('flow_runs')
      .update({ checkpoint: serializeCheckpoint(checkpoint), updated_at: new Date().toISOString() })
      .eq('id', flowId);
  } catch {
    // checkpoint 落库失败不影响执行主流程
  }
}

/** 从 flow_runs 读取已保存的 checkpoint（应显示脱敏后的 inputs） */
export async function loadCheckpoint(flowId: string): Promise<unknown> {
  try {
    const { data } = await supabase
      .from('flow_runs')
      .select('checkpoint')
      .eq('id', flowId)
      .maybeSingle();
    return data?.checkpoint ?? null;
  } catch {
    return null;
  }
}

// 执行一个工作流（内部 API 与外部调用 API 共用），完成后落库
export async function runFlow(
  flowData: TinyflowData,
  inputs: Record<string, unknown>,
  options: RunFlowOptions = {},
): Promise<RunFlowResult> {
  const flowId = crypto.randomUUID();
  const events: Array<{ type: string; data: unknown; timestamp: number }> = [];
  const startTime = Date.now();

  // ===== 幂等：相同 idempotencyKey 的重复请求直接返回首次结果 =====
  if (options.idempotencyKey) {
    const claimed = idempotencyStore.claim(options.idempotencyKey, () => ({
      flowId,
      status: 'running',
      duplicate: false,
    }));
    if (!claimed.created) {
      // 若已有最终态则直接返回；若仍在 running，则继续执行新流（首次执行未 settle 时兜底）
      const existing = claimed.result;
      if (existing.status !== 'running') {
        return { ...existing, events: [], duplicate: true } as RunFlowResult;
      }
    }
  }

  const engine = new FlowEngine(flowData, {
    flowData,
    inputs,
    userId: options.userId,
    workflowId: options.workflowId ?? null,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    maxConcurrency: options.maxConcurrency,
    onNodeStart: (nodeId: string) => {
      events.push({ type: 'node_start', data: { nodeId }, timestamp: Date.now() });
    },
    onNodeComplete: (nodeId: string, result) => {
      events.push({
        type: 'node_complete',
        data: {
          nodeId,
          status: result.status,
          outputs: redactForTrace(result.outputs),
          error: result.error,
          duration: result.duration,
          attempt: result.attempt,
          retryCount: result.retryCount,
        },
        timestamp: Date.now(),
      });
    },
    onFlowComplete: (outputs) => {
      events.push({ type: 'flow_complete', data: { outputs: redactForTrace(outputs) }, timestamp: Date.now() });
    },
    onFlowError: (error) => {
      events.push({ type: 'flow_error', data: { error: error.message }, timestamp: Date.now() });
    },
    onCheckpoint: (fid, cp) => {
      persistCheckpoint(fid, cp as CheckpointData).catch(() => {});
    },
  });

  flowRunStore.create(flowId, {
    flowId,
    engine,
    status: 'running',
    context: engine.getContext(),
    userId: options.userId,
    createdAt: startTime,
    updatedAt: startTime,
  });

  // 初始落库（running）；inputs 脱敏后保存
  await saveFlowRun(flowId, {
    workflowId: options.workflowId,
    userId: options.userId,
    source: options.source,
    status: 'running',
    inputs: redactForTrace(inputs) as Record<string, unknown> | null,
    flowData: flowData,
    startTime,
  });

  try {
    await engine.run();
    flowRunStore.update(flowId, { status: 'completed' });

    const finalOutputs = extractFinalOutputs(flowData, engine);
    const persistedStatus = runStateToPersistedStatus(engine.getState());
    const finalTrace = engine.getTrace();

    await saveFlowRun(flowId, {
      status: persistedStatus,
      outputs: redactForTrace(finalOutputs) as Record<string, unknown> | null,
      events,
      startTime,
      finishTime: Date.now(),
      trace: finalTrace,
      tokenUsage: traceToTokenUsage(finalTrace),
      cost: finalTrace.cost,
      retryCount: finalTrace.retryCount,
    });

    // 幂等 settle：记录最终结果
    if (options.idempotencyKey) {
      idempotencyStore.settle(options.idempotencyKey, {
        flowId,
        status: persistedStatus,
        outputs: finalOutputs,
        duplicate: false,
      });
    }

    return { flowId, status: persistedStatus, outputs: finalOutputs, events, trace: engine.getTrace() };
  } catch (err) {
    const error = err as FlowError;

    // 确认暂停
    if (isConfirmError(error) && error.confirmRequest) {
      flowRunStore.update(flowId, {
        status: 'paused',
        confirmRequest: error.confirmRequest,
        context: engine.getContext(),
      });

      await saveFlowRun(flowId, { status: 'paused', events, startTime, trace: engine.getTrace() });

      return {
        flowId,
        status: 'paused',
        confirmRequest: error.confirmRequest,
        events,
        trace: engine.getTrace(),
      };
    }

    const runState = engine.getState();
    const persistedStatus = runStateToPersistedStatus(runState);

    flowRunStore.update(flowId, { status: persistedStatus });
    const failedTrace = engine.getTrace();
    await saveFlowRun(flowId, {
      status: persistedStatus,
      error: error.message,
      events,
      startTime,
      finishTime: Date.now(),
      trace: failedTrace,
      tokenUsage: traceToTokenUsage(failedTrace),
      cost: failedTrace.cost,
      retryCount: failedTrace.retryCount,
    });

    if (options.idempotencyKey) {
      idempotencyStore.settle(options.idempotencyKey, {
        flowId,
        status: persistedStatus,
        error: error.message,
        duplicate: false,
      });
    }

    return {
      flowId,
      status: persistedStatus as RunFlowResult['status'],
      error: error.message,
      events,
      trace: engine.getTrace(),
    };
  }
}
