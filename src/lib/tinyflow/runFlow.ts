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

// 提取最终输出（整理好的结果，外部可直接取用）：
// 1. endNode 配置了输出引用 → 返回 endNode 定义的结果
// 2. 否则 → 智能提取最终结果，统一返回 { result: <最终输出> }：
//    - 优先取最后一个 LLM 节点的输出（outType=json 时直接给解析后的对象）
//    - 无 LLM 节点时取最后一个有输出的业务节点
// 完整节点输出保留在执行事件（events）中，不影响调试
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

  // 回退 1：最后一个 LLM 节点 → { result: 输出 }
  const llmNodes = flowData.nodes.filter((n) => n.type === 'llmNode');
  const lastLlm = llmNodes[llmNodes.length - 1];
  if (lastLlm) {
    const out = engine.getContext().nodeOutputs.get(lastLlm.id);
    if (out && out.output != null) {
      // outType=json 时 output 是 JSON 字符串，直接给解析后的对象（root）
      return { result: out.root ?? out.output };
    }
  }

  // 回退 2：最后一个有输出的业务节点 → { result: 主要输出 }
  const summary: Record<string, unknown> = {};
  for (const [nodeId, outputs] of engine.getContext().nodeOutputs) {
    if (outputs && typeof outputs === 'object' && Object.keys(outputs).length > 0) {
      const nodeType = flowData.nodes.find((n) => n.id === nodeId)?.type;
      if (nodeType === 'startNode' || nodeType === 'endNode') continue;
      summary[nodeId] = outputs;
    }
  }
  const keys = Object.keys(summary);
  if (keys.length === 1) {
    const v = summary[keys[0]];
    if (v && typeof v === 'object' && 'output' in (v as Record<string, unknown>)) {
      return { result: (v as Record<string, unknown>).output };
    }
    return { result: v };
  }
  return summary;
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
    userId: options.userId,
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

    const finalOutputs = extractFinalOutputs(flowData, engine);

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
