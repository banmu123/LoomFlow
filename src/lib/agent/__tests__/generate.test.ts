import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// ===== mock 依赖 =====
const mocks = vi.hoisted(() => {
  const streamText = vi.fn();
  const getAllModels = vi.fn();
  const from = vi.fn();
  return { streamText, getAllModels, from };
});

vi.mock('@/lib/supabase/server', () => ({
  supabase: { from: mocks.from },
}));
vi.mock('ai', () => ({
  streamText: mocks.streamText,
  isStepCount: vi.fn(() => 'step-count'),
}));
vi.mock('@/lib/ai/db-models', () => ({ getAllModels: mocks.getAllModels }));
vi.mock('@/lib/ai', () => ({
  getProviderClientForModel: vi.fn(() => vi.fn()),
  hasCapability: vi.fn(() => false),
}));
vi.mock('@/lib/agent/tools', () => ({
  agentTools: [],
  agentToolsPrompt: '',
  systemNavPrompt: '',
}));
vi.mock('@/lib/agent/intent', () => ({ detectIntentFromMessages: vi.fn(() => 'chat') }));
vi.mock('@/lib/workflow-ai/prompts', () => ({ buildSystemPrompt: vi.fn(() => 'prompt') }));

import { ensureGeneration } from '../generate';

function asyncGen<T>(parts: T[]): AsyncGenerator<T, void, unknown> {
  return (async function* () {
    for (const p of parts) yield p;
  })();
}

// ensureGeneration 是 fire-and-forget（不 await 执行器）——轮询等待执行器完成
async function waitFor(predicate: () => boolean, timeoutMs = 3000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('等待执行器完成超时');
    await new Promise((r) => setTimeout(r, 10));
  }
}

// 链式查询 mock：select 记录参数，await 时按 select 参数分发结果
function makeChain(terminalBySelect: (sel: string) => Promise<unknown>) {
  const obj: Record<string, unknown> = { __sel: '' };
  ['select', 'eq', 'order', 'update', 'insert', 'delete', 'single'].forEach((k) => {
    obj[k] = vi.fn(() => obj);
  });
  (obj.select as Mock).mockImplementation((sel: string) => {
    obj.__sel = sel;
    return obj;
  });
  obj.then = (resolve: (v: unknown) => void) => {
    terminalBySelect(String(obj.__sel)).then(resolve);
  };
  return obj;
}

const MODEL = {
  id: 'm1',
  provider: 'deepseek',
  label: 'm',
  capabilities: ['text'],
  baseURL: 'https://x',
  apiKey: 'k',
};

// 默认 supabase mock：读历史返回 1 条 user 消息；update 收集到 sink
function setupFrom(
  updateSink?: Array<Record<string, unknown>>,
  statusResult?: string,
) {
  mocks.from.mockImplementation((table: string) => {
    const chain = makeChain(async (sel: string) => {
      if (table === 'messages' && sel === 'status') {
        return { data: { status: statusResult ?? 'pending' }, error: null };
      }
      return {
        data: [{ id: 'm-1', role: 'user', content: '你好', created_at: '2026-01-01' }],
        error: null,
      };
    });
    if (updateSink) {
      (chain.update as Mock).mockImplementation((patch: Record<string, unknown>) => {
        updateSink.push(patch);
        return chain;
      });
    }
    return chain;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupFrom();
  mocks.getAllModels.mockResolvedValue([MODEL]);
});

describe('runAiGeneration / ensureGeneration', () => {
  it('正常流程：streamText 产出文本 → 消息最终写 done', async () => {
    mocks.streamText.mockReturnValue({
      fullStream: asyncGen([{ type: 'text-delta', id: '1', text: '你好' }]),
    });
    const updates: Array<Record<string, unknown>> = [];
    setupFrom(updates);

    await ensureGeneration({ conversationId: 'c1', assistantMessageId: 'a1' });
    await waitFor(() => updates.some((p) => p.status === 'done'));

    expect(mocks.streamText).toHaveBeenCalledTimes(1);
    // 最终一次 PATCH 为 done，content 为累积文本
    const donePatch = updates.find((p) => p.status === 'done');
    expect(donePatch?.content).toBe('你好');
  });

  it('ensureGeneration 幂等：同一 assistantMessageId 重复触发只执行一次', async () => {
    mocks.streamText.mockReturnValue({
      fullStream: asyncGen([
        { type: 'text-delta', id: '1', text: 'a' },
        { type: 'text-delta', id: '2', text: 'b' },
      ]),
    });
    const updates: Array<Record<string, unknown>> = [];
    setupFrom(updates);

    // 模拟发消息端点 + 轮询端点同时触发
    await Promise.all([
      ensureGeneration({ conversationId: 'c1', assistantMessageId: 'dup-1' }),
      ensureGeneration({ conversationId: 'c1', assistantMessageId: 'dup-1' }),
    ]);
    await waitFor(() => updates.some((p) => p.status === 'done'));

    expect(mocks.streamText).toHaveBeenCalledTimes(1);
  });

  it('未配置模型：消息写 error「尚未配置模型」', async () => {
    mocks.getAllModels.mockResolvedValue([]);
    const updates: Array<Record<string, unknown>> = [];
    setupFrom(updates);

    await ensureGeneration({ conversationId: 'c1', assistantMessageId: 'a-nomodel' });
    await waitFor(() => updates.length > 0);

    expect(
      updates.some(
        (p) => p.status === 'error' && String(p.error).includes('尚未配置模型'),
      ),
    ).toBe(true);
  });

  it('cancelled：写库前检查到 DB 状态为 cancelled → 停止并写 cancelled', async () => {
    mocks.streamText.mockReturnValue({
      fullStream: asyncGen([{ type: 'text-delta', id: '1', text: '部分内容' }]),
    });
    const updates: Array<Record<string, unknown>> = [];
    // select('status') 返回 cancelled（模拟用户已点停止）
    setupFrom(updates, 'cancelled');

    await ensureGeneration({ conversationId: 'c1', assistantMessageId: 'a-cancel' });
    await waitFor(() => updates.some((p) => p.status === 'cancelled'));

    expect(updates.some((p) => p.status === 'cancelled')).toBe(true);
  });

  it('不同 assistantMessageId 可并行触发（互不阻塞）', async () => {
    mocks.streamText.mockReturnValue({
      fullStream: asyncGen([{ type: 'text-delta', id: '1', text: 'x' }]),
    });
    const updates: Array<Record<string, unknown>> = [];
    setupFrom(updates);

    await Promise.all([
      ensureGeneration({ conversationId: 'c1', assistantMessageId: 'p1' }),
      ensureGeneration({ conversationId: 'c1', assistantMessageId: 'p2' }),
    ]);
    await waitFor(() => updates.filter((p) => p.status === 'done').length >= 2);

    expect(mocks.streamText).toHaveBeenCalledTimes(2);
  });
});
