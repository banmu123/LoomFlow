/**
 * LocalWorkflowRuntime 测试
 *
 * 重点覆盖：
 * 1. 节点生命周期事件（node_start / node_complete / node_error）能被发射并落库
 * 2. 非法工作流不会创建执行记录
 * 3. stop() 能中止运行中的流程并把执行记录标记为 cancelled
 *
 * 通过 mock '@/lib/tinyflow' 的 FlowEngine 与 '@/lib/tinyflow/schema' 的校验函数，
 * 避免真正执行引擎（引擎已有自己的单测）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FlowEvent } from '../app/runtime';
import type { FlowEventRecord } from '../app/repositories/workflow-repository';

// ===== Hoisted 测试替身状态 =====
const h = vi.hoisted(() => ({
  /** 引擎 run() 的行为，可被各用例替换 */
  behavior: async (_options: Record<string, unknown>) => {},
  validation: { valid: true, errors: [] as { message: string }[] },
}));

vi.mock('@/lib/tinyflow', () => ({
  FlowEngine: class {
    private options: Record<string, unknown>;
    constructor(_flowData: unknown, options: Record<string, unknown>) {
      this.options = options;
    }
    async run() {
      await h.behavior(this.options);
    }
    getContext() {
      return { nodeOutputs: new Map<string, Record<string, unknown>>() };
    }
  },
}));

vi.mock('@/lib/tinyflow/schema', () => ({
  validateWorkflow: () => h.validation,
}));

// ===== 测试用 Repository 替身 =====
function createRepoStub() {
  const flowEvents: Array<{ executionId: string; event: Omit<FlowEventRecord, 'id' | 'executionId' | 'createdAt'> }> = [];
  const executionUpdates: Array<Record<string, unknown>> = [];
  let executionSeq = 0;

  return {
    flowEvents,
    executionUpdates,
    createExecution: vi.fn(async (workflowId: string, input: Record<string, unknown>) => ({
      id: `exec-${++executionSeq}`,
      workflowId,
      status: 'running' as const,
      input,
      output: null,
      error: null,
      startedAt: '2024-01-01 00:00:00',
      completedAt: null,
      durationMs: null,
    })),
    updateExecution: vi.fn(async (_id: string, updates: Record<string, unknown>) => {
      executionUpdates.push(updates);
    }),
    addFlowEvent: vi.fn(async (executionId: string, event: Omit<FlowEventRecord, 'id' | 'executionId' | 'createdAt'>) => {
      flowEvents.push({ executionId, event });
    }),
  };
}

const FLOW = {
  nodes: [
    { id: 'n1', type: 'startNode', position: { x: 0, y: 0 }, data: { title: 'Start' } },
    { id: 'n2', type: 'llmNode', position: { x: 1, y: 0 }, data: { title: 'LLM' } },
    { id: 'end', type: 'endNode', position: { x: 2, y: 0 }, data: { title: 'End' } },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

beforeEach(() => {
  h.validation = { valid: true, errors: [] };
  h.behavior = async () => {};
});

describe('LocalWorkflowRuntime', () => {
  it('should emit and persist node lifecycle events', async () => {
    const { LocalWorkflowRuntime } = await import('../app/runtime');
    const repo = createRepoStub();
    const runtime = new LocalWorkflowRuntime(repo as never);

    const emitted: FlowEvent[] = [];
    runtime.onEvent((e) => emitted.push(e));

    h.behavior = async (options) => {
      const opts = options as {
        onNodeStart?: (id: string) => void;
        onNodeComplete?: (id: string, r: Record<string, unknown>) => void;
      };
      opts.onNodeStart?.('n1');
      opts.onNodeComplete?.('n1', { status: 'success', duration: 12, outputs: { value: 'ok' } });
      opts.onNodeStart?.('n2');
      opts.onNodeComplete?.('n2', { status: 'failed', duration: 3, outputs: {}, error: 'boom' });
    };

    const res = await runtime.execute({ flowData: FLOW as never, inputs: {}, workflowId: 'wf-1' });

    expect(res.status).toBe('completed');
    expect(res.executionId).toBe('exec-1');

    const types = emitted.map((e) => e.type);
    expect(types).toEqual([
      'flow_start',
      'node_start',
      'node_complete',
      'node_start',
      'node_error',
      'flow_complete',
    ]);

    // 事件带上 nodeType，便于 Trace 面板展示
    const nodeStart = emitted.find((e) => e.type === 'node_start');
    expect(nodeStart?.nodeType).toBe('startNode');
    expect(nodeStart?.executionId).toBe('exec-1');

    // node_error 带错误信息
    const nodeError = emitted.find((e) => e.type === 'node_error');
    expect(nodeError?.data?.error).toBe('boom');

    // 落库：flow_start + 4 个节点事件 + flow_complete
    const persistedTypes = repo.flowEvents.map((f) => f.event.eventType);
    expect(persistedTypes).toEqual(types);
    expect(repo.executionUpdates[0]).toMatchObject({ status: 'completed' });
  });

  it('should not create an execution record for an invalid workflow', async () => {
    const { LocalWorkflowRuntime } = await import('../app/runtime');
    const repo = createRepoStub();
    const runtime = new LocalWorkflowRuntime(repo as never);

    h.validation = { valid: false, errors: [{ message: '缺少开始节点' }] };

    const res = await runtime.execute({ flowData: FLOW as never, inputs: {}, workflowId: 'wf-1' });

    expect(res.status).toBe('failed');
    expect(res.error).toContain('缺少开始节点');
    expect(repo.createExecution).not.toHaveBeenCalled();
    expect(repo.addFlowEvent).not.toHaveBeenCalled();
  });

  it('should mark execution as cancelled when stop() is called', async () => {
    const { LocalWorkflowRuntime } = await import('../app/runtime');
    const repo = createRepoStub();
    const runtime = new LocalWorkflowRuntime(repo as never);

    const emitted: FlowEvent[] = [];
    runtime.onEvent((e) => emitted.push(e));

    // 引擎一直挂起，直到 signal 被 abort
    h.behavior = async (options) => {
      const signal = (options as { signal: AbortSignal }).signal;
      await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    };

    const runPromise = runtime.execute({ flowData: FLOW as never, inputs: {}, workflowId: 'wf-1' });
    // 等待执行记录创建完成（createExecution 是第一个 await）
    await vi.waitFor(() => expect(repo.createExecution).toHaveBeenCalled());

    await runtime.stop('exec-1');
    const res = await runPromise;

    expect(res.status).toBe('cancelled');
    expect(repo.executionUpdates[0]).toMatchObject({ status: 'cancelled' });
    expect(emitted.some((e) => e.type === 'flow_error')).toBe(true);
  });
});
