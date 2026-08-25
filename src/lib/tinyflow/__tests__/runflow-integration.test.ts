import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { idempotencyStore } from '../runtime/idempotency';

const mocks = vi.hoisted(() => {
  const from = vi.fn();
  return { from };
});

vi.mock('@/lib/supabase/server', () => ({
  supabase: { from: mocks.from },
}));

// 注册测试执行器（使用真实 FlowEngine 走完整 runFlow 编排）
import { FlowEngine } from '../engine/FlowEngine';
import { ExecutorRegistry } from '../executors';
import { BaseExecutor } from '../executors/BaseExecutor';
import type { FlowNode, FlowContext, TinyflowData, SubFlowRunner } from '../types';
import { runFlow } from '../runFlow';

class DelayExec extends BaseExecutor {
  async execute(_n: FlowNode, _c: FlowContext, _s?: SubFlowRunner, signal?: AbortSignal): Promise<Record<string, unknown>> {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const t = setTimeout(resolve, 10);
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true });
    });
    return { output: 1 };
  }
}
class SlowExec extends BaseExecutor {
  async execute(_n: FlowNode, _c: FlowContext, _s?: SubFlowRunner, signal?: AbortSignal): Promise<Record<string, unknown>> {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const t = setTimeout(resolve, 5000);
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true });
    });
    return { output: 1 };
  }
}
for (const [t, c] of [['xDelay', DelayExec], ['xSlow', SlowExec]] as Array<[string, typeof DelayExec]>) {
  ExecutorRegistry.register(t, c as never);
}

function flow(): TinyflowData {
  return {
    nodes: [
      { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: { title: 'start', parameters: [] } as never },
      { id: 'd', type: 'xDelay', position: { x: 0, y: 0 }, data: { title: 'd', parameters: [] } as never },
      { id: 'end', type: 'endNode', position: { x: 0, y: 0 }, data: { title: 'end', parameters: [] } as never },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'd' },
      { id: 'e2', source: 'd', target: 'end' },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  } as TinyflowData;
}

// 通用 supabase 链式 mock
function setup() {
  mocks.from.mockImplementation(() => {
    const chain: Record<string, unknown> = {};
    ['select', 'eq', 'update', 'insert', 'maybeSingle'].forEach((k) => {
      chain[k] = vi.fn(() => chain);
    });
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
    return chain;
  });
  return { };
}

beforeEach(() => {
  vi.clearAllMocks();
  idempotencyStore.clear();
});

describe('runFlow 集成（真实 Runtime）', () => {
  it('正常执行返回 completed，带 trace', async () => {
    setup();
    const result = await runFlow(flow(), {}, {});
    expect(result.status).toBe('completed');
    expect(result.outputs).toBeDefined();
    expect(result.trace).toBeDefined();
  });

  it('idempotencyKey：重复请求直接返回首次结果，不重复执行', async () => {
    setup();
    const first = await runFlow(flow(), {}, { idempotencyKey: 'req-1' });
    expect(first.status).toBe('completed');

    const second = await runFlow(flow(), {}, { idempotencyKey: 'req-1' });
    expect(second.duplicate).toBe(true);
    expect(second.status).toBe('completed');
  });

  it('工作流超时：返回 timeout 状态', async () => {
    setup();
    const result = await runFlow(
      {
        nodes: [
          { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: { title: 'start', parameters: [] } as never },
          { id: 's', type: 'xSlow', position: { x: 0, y: 0 }, data: { title: 's', parameters: [] } as never },
        ],
        edges: [{ id: 'e1', source: 'start', target: 's' }],
        viewport: { x: 0, y: 0, zoom: 1 },
      } as TinyflowData,
      {},
      { timeoutMs: 30 },
    );
    expect(result.status).toBe('timeout');
  });

  it('取消（外部 signal abort）：返回 cancelled', async () => {
    setup();
    const controller = new AbortController();
    const promise = runFlow(flow(), {}, { signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    const result = await promise;
    expect(result.status).toBe('cancelled');
  });
});
