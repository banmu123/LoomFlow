import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

const mocks = vi.hoisted(() => {
  const from = vi.fn();
  return { from };
});

vi.mock('@/lib/supabase/server', () => ({
  supabase: { from: mocks.from },
}));

import { saveFlowRun } from '../runFlow';

// 链式 mock：maybeSingle 返回 exists 状态，update 记录 patch
function setup(exists: boolean) {
  const updatePatch: Array<Record<string, unknown>> = [];
  const insertArgs: Array<Record<string, unknown>> = [];
  mocks.from.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {};
    ['select', 'eq', 'update', 'insert', 'maybeSingle'].forEach((k) => {
      chain[k] = vi.fn(() => chain);
    });
    (chain.select as Mock).mockImplementation(() => chain);
    (chain.eq as Mock).mockImplementation(() => chain);
    (chain.update as Mock).mockImplementation((patch: Record<string, unknown>) => {
      updatePatch.push(patch);
      return chain;
    });
    (chain.insert as Mock).mockImplementation((row: Record<string, unknown>) => {
      insertArgs.push(row);
      return chain;
    });
    chain.then = (resolve: (v: unknown) => void) => {
      resolve({ data: exists ? { id: 'f1' } : null, error: null });
    };
    return chain;
  });
  return { updatePatch, insertArgs };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('saveFlowRun 更新分支', () => {
  it('二次更新（completed）不覆盖首次写入的 inputs/workflow_id（回归：执行历史输入被清空）', async () => {
    const { updatePatch } = setup(true); // 记录已存在 → 走 update

    // 首次写入带 inputs
    await saveFlowRun('f1', {
      workflowId: 'w1',
      userId: 'u1',
      source: 'internal',
      status: 'running',
      inputs: { query: '你好' },
    });

    // 完成时只更新 status/outputs/events
    await saveFlowRun('f1', {
      status: 'completed',
      outputs: { result: 'ok' },
      events: [],
    });

    // 第二次 update 的 patch 不含 inputs/workflow_id（不覆盖首次值）
    const completedPatch = updatePatch[updatePatch.length - 1];
    expect(completedPatch.status).toBe('completed');
    expect(completedPatch.inputs).toBeUndefined();
    expect(completedPatch.workflow_id).toBeUndefined();
    expect(completedPatch.outputs).toEqual({ result: 'ok' });
  });

  it('不存在时走 insert（首次写入完整 row 含 inputs）', async () => {
    const { insertArgs } = setup(false);

    await saveFlowRun('f2', {
      workflowId: 'w2',
      userId: 'u2',
      status: 'running',
      inputs: { a: 1 },
    });

    expect(insertArgs).toHaveLength(1);
    expect(insertArgs[0].inputs).toEqual({ a: 1 });
    expect(insertArgs[0].workflow_id).toBe('w2');
    expect(insertArgs[0].status).toBe('running');
  });
});
