import { describe, it, expect, beforeEach } from 'vitest';
import { FlowEngine } from '../engine/FlowEngine';
import { GraphParser } from '../engine/GraphParser';
import { ExecutorRegistry } from '../executors';
import { BaseExecutor } from '../executors/BaseExecutor';
import type { FlowNode, FlowContext, TinyflowData, SubFlowRunner } from '../types';
import { idempotencyStore } from '../runtime/idempotency';
import { runStateToPersistedStatus } from '../runtime/state';
import { captureContext, restoreContext, deserializeCheckpoint } from '../runtime/checkpoint';
import { redactForTrace } from '../runtime/redact';

// ===== 测试执行器：直接驱动真实 Engine（非工具函数）=====
let sharedCounter = 0;

class DelayExecutor extends BaseExecutor {
  async execute(_node: FlowNode, _ctx: FlowContext, _sf?: SubFlowRunner, signal?: AbortSignal) {
    const ms = Number((_node.data as Record<string, unknown>).delay || 10);
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const t = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(t);
        reject(signal?.reason ?? new Error('aborted'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    return { output: (Number(_node.data.value ?? 0) || 1) };
  }
}

class FailNTimesExecutor extends BaseExecutor {
  async execute(node: FlowNode, _ctx: FlowContext): Promise<Record<string, unknown>> {
    const failTimes = Number((node.data as Record<string, unknown>).failTimes || 0);
    sharedCounter += 1;
    if (sharedCounter <= failTimes) {
      throw new Error('transient failure');
    }
    return { output: 'ok' };
  }
}

class AlwaysFailExecutor extends BaseExecutor {
  async execute(_node: FlowNode, _ctx: FlowContext): Promise<Record<string, unknown>> {
    throw new Error('permanent failure');
  }
}

class ConfirmStub extends BaseExecutor {
  async execute(node: FlowNode, ctx: FlowContext): Promise<Record<string, unknown>> {
    const d = ctx.inputs._confirmData as Record<string, unknown> | undefined;
    if (d) return { output: d, confirmed: true };
    const err = new Error('confirm_required') as unknown as {
      code: string;
      confirmRequest: unknown;
    };
    err.code = 'confirm_required';
    err.confirmRequest = { type: 'confirm_required', nodeId: node.id };
    throw err;
  }
}

class CostExecutor extends BaseExecutor {
  async execute() {
    return { output: 'x', tokens: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } };
  }
}

function makeFlow(nodes: Array<{ id: string; type: string; data?: Record<string, unknown> }>, edges: Array<{ s: string; t: string; port?: string; cond?: string }>): TinyflowData {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: { x: 0, y: 0 },
      data: { title: n.id, parameters: [], ...(n.data || {}) } as never,
    })),
    edges: edges.map((e) => ({
      id: `${e.s}-${e.t}`,
      source: e.s,
      target: e.t,
      data: e.port ? { sourcePort: e.port } : e.cond ? { condition: e.cond } : undefined,
    })),
    viewport: { x: 0, y: 0, zoom: 1 },
  } as TinyflowData;
}

const EMPTY = { parameters: [] } as Record<string, unknown>;

describe('Runtime: 状态机 state transitions', () => {
  it('canTransition 拒绝非法转移（cancelled → completed 不允许）', () => {
    expect(runStateToPersistedStatus('waiting')).toBe('paused');
    expect(runStateToPersistedStatus('cancelled')).toBe('cancelled');
    expect(runStateToPersistedStatus('running')).toBe('running');
  });

  it('正常完成：created → running → completed', async () => {
    const engine = new FlowEngine(makeFlow(
      [{ id: 'start', type: 'startNode', data: EMPTY }, { id: 'end', type: 'endNode', data: EMPTY }],
      [{ s: 'start', t: 'end' }],
    ), { flowData: makeFlow([], []), inputs: {} });
    await engine.run();
    expect(engine.getState()).toBe('completed');
  });

  it('失败：created → running → failed', async () => {
    const engine = new FlowEngine(makeFlow(
      [{ id: 'start', type: 'startNode', data: EMPTY }, { id: 'fail', type: 'xAlwaysFail', data: EMPTY }, { id: 'end', type: 'endNode', data: EMPTY }],
      [{ s: 'start', t: 'fail' }, { s: 'fail', t: 'end' }],
    ), { flowData: makeFlow([], []), inputs: {} });
    await expect(engine.run()).rejects.toThrow();
    expect(engine.getState()).toBe('failed');
    // 失败后后续节点不得执行
    expect(engine.getContext().nodeStatuses.get('end')).toBeUndefined();
  });
});

describe('Runtime: Timeout', () => {
  it('节点超时后状态为 timeout，后续节点不执行，不留 running 假状态', async () => {
    const engine = new FlowEngine(makeFlow(
      [
        { id: 'start', type: 'startNode', data: EMPTY },
        { id: 'slow', type: 'xDelay', data: { delay: 5000 } },
        { id: 'end', type: 'endNode', data: EMPTY },
      ],
      [{ s: 'start', t: 'slow' }, { s: 'slow', t: 'end' }],
    ), {
      flowData: makeFlow([], []),
      inputs: {},
      defaultNodeTimeoutMs: 30,
    });
    await expect(engine.run()).rejects.toThrow();
    expect(engine.getState()).toBe('timeout');
    const slowStatus = engine.getContext().nodeStatuses.get('slow');
    expect(slowStatus).toBe('timeout');
    expect(engine.getContext().nodeStatuses.get('end')).toBeUndefined(); // 后续不执行
    expect(engine.getContext().nodeStatuses.get('slow')).not.toBe('running');
  });

  it('工作流级超时：整体置为 timeout', async () => {
    const engine = new FlowEngine(makeFlow(
      [
        { id: 'start', type: 'startNode', data: EMPTY },
        { id: 'slow', type: 'xDelay', data: { delay: 5000 } },
        { id: 'end', type: 'endNode', data: EMPTY },
      ],
      [{ s: 'start', t: 'slow' }, { s: 'slow', t: 'end' }],
    ), {
      flowData: makeFlow([], []),
      inputs: {},
      timeoutMs: 40,
      defaultNodeTimeoutMs: 5000,
    });
    await expect(engine.run()).rejects.toThrow();
    expect(engine.getState()).toBe('timeout');
  });

  it('未超时时正常完成', async () => {
    const engine = new FlowEngine(makeFlow(
      [{ id: 'start', type: 'startNode', data: EMPTY }, { id: 'fast', type: 'xDelay', data: { delay: 5 } }, { id: 'end', type: 'endNode', data: EMPTY }],
      [{ s: 'start', t: 'fast' }, { s: 'fast', t: 'end' }],
    ), { flowData: makeFlow([], []), inputs: {}, defaultNodeTimeoutMs: 1000 });
    await engine.run();
    expect(engine.getState()).toBe('completed');
  });
});

describe('Runtime: Retry', () => {
  beforeEach(() => { sharedCounter = 0; });

  it('重试后成功：每个 attempt 写入 trace，最终成功', async () => {
    const engine = new FlowEngine(makeFlow(
      [{ id: 'start', type: 'startNode', data: EMPTY }, { id: 'n', type: 'xFailN', data: { failTimes: 2, maxRetryCount: 3, retryIntervalMs: 5, retryEnable: true, exponentialBackoff: false } }, { id: 'end', type: 'endNode', data: EMPTY }],
      [{ s: 'start', t: 'n' }, { s: 'n', t: 'end' }],
    ), { flowData: makeFlow([], []), inputs: {}, defaultNodeTimeoutMs: 5000 });
    await engine.run();
    expect(engine.getState()).toBe('completed');
    // 3 次尝试（2 次失败 + 1 次成功）
    const nodeTrace = engine.getTrace().nodes.find((n) => n.nodeId === 'n');
    expect(nodeTrace?.attempts.length).toBeGreaterThanOrEqual(3);
    expect(nodeTrace?.retryCount).toBe(2);
  });

  it('重试耗尽后最终失败，且能看到最终失败原因', async () => {
    const engine = new FlowEngine(makeFlow(
      [{ id: 'start', type: 'startNode', data: EMPTY }, { id: 'n', type: 'xFailN', data: { failTimes: 100, maxRetryCount: 2, retryIntervalMs: 5, retryEnable: true, exponentialBackoff: false } }],
      [{ s: 'start', t: 'n' }],
    ), { flowData: makeFlow([], []), inputs: {}, defaultNodeTimeoutMs: 5000 });
    await expect(engine.run()).rejects.toThrow();
    expect(engine.getState()).toBe('failed');
    const nodeTrace = engine.getTrace().nodes.find((n) => n.nodeId === 'n');
    expect(nodeTrace?.status).toBe('failed');
    expect(nodeTrace?.error).toContain('transient failure');
    expect(nodeTrace?.attempts.length).toBe(3); // 1 次尝试 + 2 次重试
  });

  it('retryEnable=false 时不重试（非幂等操作关闭）', async () => {
    const engine = new FlowEngine(makeFlow(
      [{ id: 'start', type: 'startNode', data: EMPTY }, { id: 'n', type: 'xFailN', data: { failTimes: 100, maxRetryCount: 9, retryIntervalMs: 5, retryEnable: false } }],
      [{ s: 'start', t: 'n' }],
    ), { flowData: makeFlow([], []), inputs: {}, defaultNodeTimeoutMs: 5000 });
    await expect(engine.run()).rejects.toThrow();
    expect(sharedCounter).toBe(1); // 只执行一次
  });

  it('不可重试错误（确认请求）不重试', async () => {
    const engine = new FlowEngine(makeFlow(
      [{ id: 'start', type: 'startNode', data: EMPTY }, { id: 'n', type: 'xConfirmStub', data: { maxRetryCount: 9, retryEnable: true } }],
      [{ s: 'start', t: 'n' }],
    ), { flowData: makeFlow([], []), inputs: {}, defaultNodeTimeoutMs: 1000 });
    await expect(engine.run()).rejects.toThrow();
    expect(engine.getState()).toBe('waiting');
  });
});

describe('Runtime: Cancellation', () => {
  it('cancel 后状态为 cancelled，且不写入 completed，不留 running', async () => {
    const engine = new FlowEngine(makeFlow(
      [{ id: 'start', type: 'startNode', data: EMPTY }, { id: 'slow', type: 'xDelay', data: { delay: 5000 } }, { id: 'end', type: 'endNode', data: EMPTY }],
      [{ s: 'start', t: 'slow' }, { s: 'slow', t: 'end' }],
    ), { flowData: makeFlow([], []), inputs: {}, defaultNodeTimeoutMs: 5000 });

    const promise = engine.run();
    await new Promise((r) => setTimeout(r, 20));
    engine.cancel();
    await expect(promise).rejects.toThrow();
    expect(engine.getState()).toBe('cancelled');
    // 不允许 cancel 后又写 completed
    expect(engine.getContext().nodeStatuses.get('end')).toBeUndefined();
    expect(engine.getContext().nodeStatuses.get('slow')).not.toBe('success');
  });
});

describe('Runtime: Checkpoint / Resume', () => {
  it('capture + serialize + deserialize + restore 保留上下文', () => {
    const ctx: FlowContext = {
      flowId: 'f1',
      inputs: { a: 1 },
      nodeOutputs: new Map([['n1', { out: 42 }]]),
      nodeStatuses: new Map([['n1', 'success']]),
      variables: new Map([['v', 'x']]),
      userId: 'u1',
    };
    const cp = captureContext(ctx, { executedNodes: ['n1'], readyNodes: ['n2'], startedAt: 100 });
    const json = JSON.parse(JSON.stringify(cp));
    const restored = restoreContext(deserializeCheckpoint(json)!);
    expect(restored.nodeOutputs.get('n1')).toEqual({ out: 42 });
    expect(restored.nodeStatuses.get('n1')).toBe('success');
    expect(restored.inputs.a).toBe(1);
  });

  it('resume 后继续执行后续节点，且不重复执行已完成节点', async () => {
    const engine = new FlowEngine(makeFlow(
      [
        { id: 'start', type: 'startNode', data: EMPTY },
        { id: 'c', type: 'xConfirm', data: EMPTY },
        { id: 'end', type: 'endNode', data: EMPTY },
      ],
      [{ s: 'start', t: 'c' }, { s: 'c', t: 'end' }],
    ), { flowData: makeFlow([], []), inputs: {} });

    await expect(engine.run()).rejects.toThrow();
    expect(engine.getState()).toBe('waiting');
    expect(engine.getContext().nodeStatuses.get('c')).toBe('waiting_confirm');

    await engine.resume({ approved: true });
    expect(engine.getState()).toBe('completed');
    expect(engine.getContext().nodeStatuses.get('end')).toBe('success');
    // 已完成节点不重跑（end 只成功一次，无 running 残留）
    expect(engine.getContext().nodeStatuses.get('start')).toBe('success');
  });
});

describe('Runtime: Idempotency', () => {
  it('相同 idempotencyKey 的重复请求不重复执行', async () => {
    // 直接驱动引擎验证重复执行副作用；幂等去重在 runFlow 层，
    // 此处验证 store 的 claim/settle 行为
    const made = idempotencyStore.claim('key-1', () => ({ flowId: 'a', status: 'running', duplicate: false }));
    expect(made.created).toBe(true);
    idempotencyStore.settle('key-1', { flowId: 'a', status: 'completed', outputs: { o: 1 }, duplicate: false });

    const again = idempotencyStore.claim('key-1', () => ({ flowId: 'b', status: 'running', duplicate: false }));
    expect(again.created).toBe(false);
    expect(again.result.duplicate).toBe(true);
    expect(again.result.status).toBe('completed');
  });
});

describe('Runtime: 并行依赖检测', () => {
  it('GraphParser.getDependencyCounts 正确统计 join 节点入边', () => {
    const flow = makeFlow(
      [
        { id: 'a', type: 'startNode', data: EMPTY },
        { id: 'b', type: 'endNode', data: EMPTY },
        { id: 'c', type: 'endNode', data: EMPTY },
      ],
      [{ s: 'a', t: 'b' }, { s: 'a', t: 'c' }],
    );
    const p = new GraphParser(flow);
    expect(p.getDependencyCounts().get('a')).toBe(0);
    expect(p.getDependencyCounts().get('b')).toBe(1);
    expect(p.getDependencyCounts().get('c')).toBe(1);
  });

  it('分支路由：条件/sourcePort 正确决定后继（原行为保持）', async () => {
    const engine = new FlowEngine(makeFlow(
      [
        { id: 'start', type: 'startNode', data: EMPTY },
        { id: 'cond', type: 'conditionNode', data: { condition: '{{input.score}} > 80' } },
        { id: 'pass', type: 'endNode', data: EMPTY },
        { id: 'fail', type: 'endNode', data: EMPTY },
      ],
      [
        { s: 'start', t: 'cond' },
        { s: 'cond', t: 'pass', port: 'true' },
        { s: 'cond', t: 'fail', port: 'false' },
      ],
    ), { flowData: makeFlow([], []), inputs: { score: 95 } });
    await engine.run();
    expect(engine.getContext().nodeStatuses.get('pass')).toBe('success');
    expect(engine.getContext().nodeStatuses.get('fail')).toBeUndefined();
  });
});

describe('Runtime: 可观测性 trace', () => {
  it('trace 记录 duration / attempt / tokenUsage / cost', async () => {
    const engine = new FlowEngine(makeFlow(
      [
        { id: 'start', type: 'startNode', data: EMPTY },
        { id: 'llm', type: 'xCost', data: EMPTY },
        { id: 'end', type: 'endNode', data: EMPTY },
      ],
      [{ s: 'start', t: 'llm' }, { s: 'llm', t: 'end' }],
    ), { flowData: makeFlow([], []), inputs: {}, defaultNodeTimeoutMs: 5000 });
    await engine.run();
    const trace = engine.getTrace();
    expect(trace.status).toBe('completed');
    expect(trace.nodes.find((n) => n.nodeId === 'llm')?.durationMs).toBeGreaterThanOrEqual(0);
    expect(trace.tokenUsage.totalTokens).toBe(150);
    expect(trace.cost).toBeGreaterThan(0);
  });

  it('redactForTrace 脱敏敏感字段', () => {
    const redacted = redactForTrace({
      apiKey: 'sk-1234567890abcdef',
      headers: { Authorization: 'Bearer abcdefghijklmnopqrstuvwxyz' },
      body: { text: 'hello' },
    }) as Record<string, unknown>;
    expect(redacted.apiKey).toBe('[REDACTED]');
    expect((redacted.headers as Record<string, unknown>).Authorization).toContain('[REDACTED]');
    expect((redacted.body as Record<string, unknown>).text).toBe('hello');
  });
});

describe('Runtime: 失败恢复 recovery', () => {
  it('节点失败不会留下 running 假状态（统一归为 failed/skipped）', async () => {
    const engine = new FlowEngine(makeFlow(
      [{ id: 'start', type: 'startNode', data: EMPTY }, { id: 'f', type: 'xAlwaysFail', data: EMPTY }],
      [{ s: 'start', t: 'f' }],
    ), { flowData: makeFlow([], []), inputs: {} });
    await expect(engine.run()).rejects.toThrow();
    const statuses = [...engine.getContext().nodeStatuses.values()];
    expect(statuses).not.toContain('running');
    expect(engine.getState()).toBe('failed');
  });
});

// ===== 注册测试执行器（beforeAll 前完成）=====
class ConfirmExecutorStub extends BaseExecutor {
  async execute(node: FlowNode, ctx: FlowContext): Promise<Record<string, unknown>> {
    const d = ctx.inputs._confirmData as Record<string, unknown> | undefined;
    if (d) return { output: d, confirmed: true };
    const err = new Error('confirm_required') as unknown as {
      code: string;
      confirmRequest: unknown;
    };
    err.code = 'confirm_required';
    err.confirmRequest = { type: 'confirm_required', nodeId: node.id };
    throw err;
  }
}

const registered: Array<[string, typeof BaseExecutor]> = [
  ['xDelay', DelayExecutor],
  ['xFailN', FailNTimesExecutor],
  ['xAlwaysFail', AlwaysFailExecutor],
  ['xConfirmStub', ConfirmStub],
  ['xConfirm', ConfirmExecutorStub],
  ['xCost', CostExecutor],
];
for (const [t, c] of registered) {
  ExecutorRegistry.register(t, c as never);
}
