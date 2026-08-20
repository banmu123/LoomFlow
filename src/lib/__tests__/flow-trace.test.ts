import { describe, it, expect } from 'vitest';
import { parseFlowTrace, getNodeLabel, formatDuration } from '../flow-trace';

const t0 = 1000;

function ev(type: string, nodeId: string, ts: number, extra: Record<string, unknown> = {}) {
  return { type, data: { nodeId, ...extra }, timestamp: ts };
}

describe('parseFlowTrace 节点执行序列解析', () => {
  it('按事件顺序还原节点执行序列（含耗时/输出/错误）', () => {
    const events = [
      ev('node_start', 'n1', t0),
      ev('node_complete', 'n1', t0 + 100, { status: 'success', outputs: { a: 1 }, duration: 100 }),
      ev('node_start', 'n2', t0 + 150),
      ev('node_complete', 'n2', t0 + 350, { status: 'success', outputs: { b: 2 }, duration: 200 }),
    ];
    const trace = parseFlowTrace(events);
    expect(trace.map((n) => n.nodeId)).toEqual(['n1', 'n2']);
    expect(trace[0].status).toBe('success');
    expect(trace[0].duration).toBe(100);
    expect(trace[0].outputs).toEqual({ a: 1 });
    expect(trace[1].duration).toBe(200);
  });

  it('失败节点状态与错误信息', () => {
    const events = [
      ev('node_start', 'n1', t0),
      ev('node_complete', 'n1', t0 + 50, { status: 'failed', error: 'boom', duration: 50 }),
    ];
    const trace = parseFlowTrace(events);
    expect(trace[0].status).toBe('failed');
    expect(trace[0].error).toBe('boom');
  });

  it('运行中的节点（只有 start 无 complete）标记 running', () => {
    const events = [ev('node_start', 'n1', t0), ev('node_start', 'n2', t0 + 10)];
    const trace = parseFlowTrace(events);
    expect(trace[0].status).toBe('running');
    expect(trace[0].duration).toBeNull();
    expect(trace).toHaveLength(2);
  });

  it('乱序事件按时间戳排序', () => {
    const events = [
      ev('node_complete', 'n2', t0 + 300, { status: 'success', duration: 300 }),
      ev('node_start', 'n1', t0),
      ev('node_complete', 'n1', t0 + 100, { status: 'success', duration: 100 }),
      ev('node_start', 'n2', t0 + 200),
    ];
    const trace = parseFlowTrace(events);
    expect(trace.map((n) => n.nodeId)).toEqual(['n1', 'n2']);
  });

  it('等待确认节点状态', () => {
    const events = [
      ev('node_start', 'n1', t0),
      ev('node_complete', 'n1', t0 + 100, { status: 'waiting_confirm', duration: 100 }),
    ];
    expect(parseFlowTrace(events)[0].status).toBe('waiting_confirm');
  });
});

describe('getNodeLabel 节点名映射', () => {
  const flowData = {
    nodes: [
      { id: 'n1', type: 'llmNode', data: { title: '文案生成' } },
      { id: 'n2', type: 'startNode', data: {} },
    ],
  };

  it('有 title 用 title', () => {
    expect(getNodeLabel(flowData, 'n1').title).toBe('文案生成');
    expect(getNodeLabel(flowData, 'n1').type).toBe('llmNode');
  });

  it('无 title 回退 type；未知节点回退 nodeId', () => {
    expect(getNodeLabel(flowData, 'n2').title).toBe('startNode');
    expect(getNodeLabel(flowData, 'ghost').title).toBe('ghost');
    expect(getNodeLabel(null, 'x').type).toBe('');
  });
});

describe('formatDuration 耗时格式化', () => {
  it('毫秒与秒', () => {
    expect(formatDuration(null)).toBe('-');
    expect(formatDuration(12)).toBe('12ms');
    expect(formatDuration(2100)).toBe('2.1s');
    expect(formatDuration(1000)).toBe('1.0s');
  });
});
