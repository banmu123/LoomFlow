import { describe, it, expect } from 'vitest';
import { summarizeRunEvents, summarizeRunsForPrompt } from '../flow-runs-summary';

const t0 = 1000;

function ev(type: string, nodeId: string, ts: number, extra: Record<string, unknown> = {}) {
  return { type, data: { nodeId, ...extra }, timestamp: ts };
}

function makeRow(overrides: Partial<Parameters<typeof summarizeRunEvents>[0]> = {}) {
  return {
    id: 'run-1',
    status: 'failed',
    created_at: '2026-08-20T10:00:00Z',
    error: 'search timeout',
    source: 'internal',
    events: [
      ev('node_start', 'start', t0),
      ev('node_complete', 'start', t0 + 10, { status: 'success', duration: 10 }),
      ev('node_start', 'search', t0 + 20),
      ev('node_complete', 'search', t0 + 10020, {
        status: 'failed',
        duration: 10000,
        error: 'ETIMEDOUT',
      }),
    ],
    flow_data: {
      nodes: [
        { id: 'start', type: 'startNode', data: { title: '开始' } },
        { id: 'search', type: 'searchEngineNode', data: { title: '网络搜索' } },
      ],
    },
    ...overrides,
  } as Parameters<typeof summarizeRunEvents>[0];
}

describe('summarizeRunEvents 运行摘要', () => {
  it('解析节点级状态/耗时/错误，并用 flow_data 映射节点名', () => {
    const s = summarizeRunEvents(makeRow());
    expect(s.status).toBe('failed');
    expect(s.error).toBe('search timeout');
    expect(s.nodes).toHaveLength(2);
    expect(s.nodes[0]).toMatchObject({ title: '开始', status: 'success', duration: 10 });
    expect(s.nodes[1]).toMatchObject({
      title: '网络搜索',
      status: 'failed',
      duration: 10000,
      error: 'ETIMEDOUT',
    });
  });

  it('无 flow_data 时节点名回退 nodeId（类型未知）', () => {
    const s = summarizeRunEvents(makeRow({ flow_data: null }));
    expect(s.nodes[1].title).toBe('search'); // 无快照时仅能显示 nodeId
  });
});

describe('summarizeRunsForPrompt 摘要文本', () => {
  it('包含运行状态/错误/节点详情（供 AI 分析）', () => {
    const runs = [summarizeRunEvents(makeRow())];
    const text = summarizeRunsForPrompt(runs);
    expect(text).toContain('failed');
    expect(text).toContain('ETIMEDOUT');
    expect(text).toContain('网络搜索');
    expect(text).toContain('10000ms');
  });

  it('无运行记录时提示', () => {
    expect(summarizeRunsForPrompt([])).toContain('暂无');
  });
});
