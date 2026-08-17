import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

const mocks = vi.hoisted(() => {
  const from = vi.fn();
  const cron = vi.fn();
  const runFlow = vi.fn();
  const fetchMock = vi.fn();
  return { from, cron, runFlow, fetchMock };
});

vi.mock('@/lib/supabase/server', () => ({
  supabase: { from: mocks.from },
}));
// croner mock：模拟真实行为——无效表达式抛错（reloadSchedules 会跳过）
vi.mock('croner', () => ({
  Cron: mocks.cron,
}));
vi.mock('@/lib/tinyflow/runFlow', () => ({ runFlow: mocks.runFlow }));
vi.mock('@/lib/tinyflow/types', () => ({}));

import { reloadSchedules, executeSchedule } from '../scheduler';

// 链式 supabase mock
function makeChain(terminal: () => Promise<unknown>) {
  const obj: Record<string, unknown> = {};
  ['select', 'eq', 'order', 'update', 'insert', 'delete', 'maybeSingle', 'single'].forEach((k) => {
    obj[k] = vi.fn(() => obj);
  });
  obj.then = (resolve: (v: unknown) => void) => {
    terminal().then(resolve);
  };
  return obj;
}

const SCHEDULE = {
  id: 's1',
  workflow_id: 'w1',
  user_id: 'u1',
  cron_expr: '*/5 * * * *',
  inputs: { query: 'hi' },
  webhook_url: 'https://hook.example.com/x',
  enabled: true,
  last_run_at: null,
};

beforeEach(() => {
  // 注意：不用 vi.clearAllMocks（Vitest 4 会清掉 mockImplementation，导致 cron 校验失效）
  mocks.from.mockClear();
  mocks.runFlow.mockClear();
  mocks.fetchMock.mockClear();
  mocks.cron.mockClear();
  // cron mock：无效表达式抛错（模拟 croner 解析失败）
  // 注意：必须用普通函数（new Cron 是构造调用，箭头函数会抛 not a constructor）
  mocks.cron.mockImplementation(function (this: unknown, expr: string) {
    if (!/^[\d*/,\-\s]+$/.test(expr)) throw new Error('Invalid cron expression');
    return { stop: vi.fn() };
  });
  mocks.runFlow.mockResolvedValue({ flowId: 'f1', status: 'completed', outputs: { ok: 1 } });
  mocks.fetchMock.mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', mocks.fetchMock);
});

describe('reloadSchedules', () => {
  // 模拟 DB 查询：.eq('enabled', true) 由 PostgREST 过滤，mock 返回过滤后的结果
  const mockRuns = (rows: Array<Record<string, unknown>>) => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'scheduled_runs') {
        return makeChain(async () => ({ data: rows, error: null }));
      }
      return makeChain(async () => ({ data: [], error: null }));
    });
  };

  it('加载所有 enabled 任务并创建 croner 任务', async () => {
    mockRuns([SCHEDULE]);

    await reloadSchedules();

    expect(mocks.cron).toHaveBeenCalledTimes(1);
    expect(mocks.cron).toHaveBeenCalledWith('*/5 * * * *', expect.any(Function));
  });

  it('无启用任务时不创建任何 croner 任务', async () => {
    mockRuns([]); // DB 过滤后无 enabled 任务

    await reloadSchedules();

    expect(mocks.cron).not.toHaveBeenCalled();
  });

  it('无效 cron 表达式被跳过（不崩溃），有效任务照常创建', async () => {
    mockRuns([
      { ...SCHEDULE, cron_expr: 'not-a-cron' },
      { ...SCHEDULE, id: 's2', cron_expr: '0 9 * * *' },
    ]);

    // 不崩溃（catch 跳过无效的）
    await expect(reloadSchedules()).resolves.toBeUndefined();
    // 两次调用：无效的抛错被跳过（type=throw）+ 有效的创建成功
    expect(mocks.cron.mock.calls).toHaveLength(2);
    expect(mocks.cron.mock.calls[0][0]).toBe('not-a-cron');
    expect(mocks.cron.mock.results[0].type).toBe('throw');
    expect(mocks.cron.mock.calls[1][0]).toBe('0 9 * * *');
    expect(mocks.cron.mock.results[1].value).toEqual(
      expect.objectContaining({ stop: expect.any(Function) }),
    );
  });

  it('重复调用先停止旧任务再重建（增删改后刷新安全）', async () => {
    const stopA = vi.fn();
    const stopB = vi.fn();
    let created = 0;
    mocks.cron.mockImplementation(function (this: unknown) {
      return { stop: created++ === 0 ? stopA : stopB };
    });
    mockRuns([SCHEDULE]);

    await reloadSchedules();
    await reloadSchedules();

    // 第一次创建的任务被 stop，第二次创建新任务
    expect(stopA).toHaveBeenCalledTimes(1);
    expect(stopB).not.toHaveBeenCalled();
    expect(mocks.cron).toHaveBeenCalledTimes(2);
  });
});

describe('executeSchedule', () => {
  it('正常执行：读工作流 → runFlow → 更新 last_run_at → webhook 回调', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const chainForRuns = () => {
      const chain = makeChain(async () => ({ data: null, error: null }));
      (chain.update as Mock).mockImplementation((patch: Record<string, unknown>) => {
        updates.push(patch);
        return chain;
      });
      return chain;
    };
    mocks.from.mockImplementation((table: string) => {
      if (table === 'workflow_history') {
        return makeChain(async () => ({
          data: { data: { nodes: [], edges: [] } },
          error: null,
        }));
      }
      if (table === 'scheduled_runs') return chainForRuns();
      return makeChain(async () => ({ data: null, error: null }));
    });

    await executeSchedule(SCHEDULE);

    // runFlow 被调用（source=api，带 workflowId/userId/inputs）
    expect(mocks.runFlow).toHaveBeenCalledTimes(1);
    expect(mocks.runFlow).toHaveBeenCalledWith(
      { nodes: [], edges: [] },
      { query: 'hi' },
      { source: 'api', workflowId: 'w1', userId: 'u1' },
    );
    // last_run_at 更新
    expect(updates.some((p) => 'last_run_at' in p)).toBe(true);
    // webhook 回调（含 outputs）
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    const webhookBody = JSON.parse(mocks.fetchMock.mock.calls[0][1].body);
    expect(webhookBody.status).toBe('completed');
    expect(webhookBody.outputs).toEqual({ ok: 1 });
  });

  it('工作流不存在：跳过执行（不崩溃、不回调）', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'workflow_history') {
        return makeChain(async () => ({ data: null, error: { message: 'not found' } }));
      }
      return makeChain(async () => ({ data: null, error: null }));
    });

    await executeSchedule(SCHEDULE);

    expect(mocks.runFlow).not.toHaveBeenCalled();
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it('runFlow 失败不阻塞（catch 吞掉）', async () => {
    mocks.runFlow.mockRejectedValue(new Error('boom'));
    mocks.from.mockImplementation((table: string) => {
      if (table === 'workflow_history') {
        return makeChain(async () => ({
          data: { data: { nodes: [], edges: [] } },
          error: null,
        }));
      }
      return makeChain(async () => ({ data: null, error: null }));
    });

    await expect(executeSchedule(SCHEDULE)).resolves.toBeUndefined();
  });
});
