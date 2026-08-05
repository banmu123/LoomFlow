import { FlowEngine, flowRunStore } from './index';
import type { TinyflowData, FlowError } from './types';
import { supabase } from '@/lib/supabase/server';

export interface RunFlowResult {
  flowId: string;
  status: 'running' | 'completed' | 'paused' | 'failed';
  outputs?: Record<string, unknown>;
  events?: Array<{ type: string; data: unknown; timestamp: number }>;
  confirmRequest?: unknown;
  error?: string;
}

export interface RunFlowOptions {
  source?: 'internal' | 'api';
  workflowId?: string | null;
  userId?: string | null;
}

// 写入/更新执行记录（落库持久化）
export async function saveFlowRun(
  flowId: string,
  data: {
    workflowId?: string | null;
    userId?: string | null;
    source?: 'internal' | 'api';
    status?: string;
    inputs?: Record<string, unknown> | null;
    outputs?: Record<string, unknown> | null;
    events?: Array<{ type: string; data: unknown; timestamp: number }> | null;
    error?: string | null;
  },
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
    };

    if (exists.data) {
      await supabase
        .from('flow_runs')
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq('id', flowId);
    } else {
      await supabase.from('flow_runs').insert({ id: flowId, ...row });
    }
  } catch {
    // 落库失败不影响执行
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

  const engine = new FlowEngine(flowData, {
    flowData,
    inputs,
    onNodeStart: (nodeId: string) => {
      events.push({ type: 'node_start', data: { nodeId }, timestamp: Date.now() });
    },
    onNodeComplete: (nodeId: string, result) => {
      events.push({
        type: 'node_complete',
        data: {
          nodeId,
          status: result.status,
          outputs: result.outputs,
          error: result.error,
          duration: result.duration,
        },
        timestamp: Date.now(),
      });
    },
    onFlowComplete: (outputs) => {
      events.push({ type: 'flow_complete', data: { outputs }, timestamp: Date.now() });
    },
    onFlowError: (error) => {
      events.push({ type: 'flow_error', data: { error: error.message }, timestamp: Date.now() });
    },
  });

  flowRunStore.create(flowId, {
    flowId,
    engine,
    status: 'running',
    context: engine.getContext(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  // 初始落库（running）
  await saveFlowRun(flowId, {
    workflowId: options.workflowId,
    userId: options.userId,
    source: options.source,
    status: 'running',
    inputs,
  });

  try {
    await engine.run();
    flowRunStore.update(flowId, { status: 'completed' });

    const endNode = flowData.nodes.find((n) => n.type === 'endNode');
    const finalOutputs = endNode
      ? engine.getContext().nodeOutputs.get(endNode.id) || {}
      : {};

    await saveFlowRun(flowId, {
      status: 'completed',
      outputs: finalOutputs,
      events,
    });

    return { flowId, status: 'completed', outputs: finalOutputs, events };
  } catch (err) {
    const error = err as FlowError;

    // 确认暂停
    if (error.code === 'confirm_required' && error.confirmRequest) {
      flowRunStore.update(flowId, {
        status: 'paused',
        confirmRequest: error.confirmRequest,
        context: engine.getContext(),
      });

      await saveFlowRun(flowId, { status: 'paused', events });

      return {
        flowId,
        status: 'paused',
        confirmRequest: error.confirmRequest,
        events,
      };
    }

    flowRunStore.update(flowId, { status: 'failed' });
    await saveFlowRun(flowId, {
      status: 'failed',
      error: error.message,
      events,
    });
    return { flowId, status: 'failed', error: error.message, events };
  }
}
