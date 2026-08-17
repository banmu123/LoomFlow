import { describe, it, expect } from 'vitest';
import { FlowEngine } from '../engine/FlowEngine';
import type { TinyflowData } from '../types';

// 最小工作流：start → end（start 节点透传 input）
function echoFlow(): TinyflowData {
  return {
    nodes: [
      {
        id: 'start',
        type: 'startNode',
        data: {
          parameters: [
            { id: 'p1', name: 'query', dataType: 'String', refType: 'input' },
          ],
        },
      },
      {
        id: 'end',
        type: 'endNode',
        data: { parameters: [{ id: 'e1', name: 'result', refType: 'ref', ref: 'start.query' }] },
      },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
  } as TinyflowData;
}

describe('FlowEngine', () => {
  it('执行 start → end 流程并返回输出', async () => {
    const engine = new FlowEngine(echoFlow(), {
      flowData: echoFlow(),
      inputs: { query: 'hello' },
    });
    await engine.run();

    const endOutputs = engine.getContext().nodeOutputs.get('end');
    expect(endOutputs).toBeDefined();
  });

  it('输入参数可被下游引用解析', async () => {
    const engine = new FlowEngine(echoFlow(), {
      flowData: echoFlow(),
      inputs: { query: '你好' },
    });
    await engine.run();

    const ctx = engine.getContext();
    const startOutputs = ctx.nodeOutputs.get('start');
    // start 节点输出应包含输入值
    expect(JSON.stringify(startOutputs)).toContain('你好');
  });

  it('缺输入参数时流程仍可执行（空输入）', async () => {
    const engine = new FlowEngine(echoFlow(), {
      flowData: echoFlow(),
      inputs: {},
    });
    await expect(engine.run()).resolves.not.toThrow();
  });
});

describe('extractFinalOutputs 回退汇总', () => {
  it('endNode 无输出配置时汇总各节点结果（不依赖外部 API）', async () => {
    const { runFlow } = await import('../runFlow');
    const flow = {
      nodes: [
        { id: 'start', type: 'startNode', data: { parameters: [] } },
        {
          id: 'code',
          type: 'codeNode',
          data: {
            code: 'return { answer: 42 };',
            outputDefs: [{ id: 'o1', name: 'result' }],
          },
        },
        { id: 'end', type: 'endNode', data: {} },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'code' },
        { id: 'e2', source: 'code', target: 'end' },
      ],
    };
    const result = await runFlow(flow as never, {});
    expect(result.status).toBe('completed');
    // endNode 无 outputDefs → 回退汇总应包含 code 节点输出
    expect(result.outputs).toBeDefined();
    expect(JSON.stringify(result.outputs)).toContain('code');
    expect(JSON.stringify(result.outputs)).toContain('42');
  }, 15000);
});

describe('输出端口路由（sourcePort，条件节点分支）', () => {
  it('true 分支：sourcePort=true 的边在条件为真时走', async () => {
    const { FlowEngine } = await import('../engine/FlowEngine');
    const { ExecutorRegistry } = await import('../executors');
    const flowData = {
      nodes: [
        { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: {} },
        {
          id: 'cond',
          type: 'conditionNode',
          position: { x: 0, y: 0 },
          data: { condition: '{{input.score}} > 80' },
        },
        { id: 'pass', type: 'endNode', position: { x: 0, y: 0 }, data: {} },
        { id: 'fail', type: 'endNode', position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'cond' },
        { id: 'e2', source: 'cond', target: 'pass', data: { sourcePort: 'true' } },
        { id: 'e3', source: 'cond', target: 'fail', data: { sourcePort: 'false' } },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const engine = new FlowEngine(flowData as never, {
      flowData: flowData as never,
      inputs: { score: 95 },
    });
    await engine.run();
    // 条件为真 → pass 节点执行，fail 未执行
    expect(engine.getContext().nodeStatuses.get('pass')).toBe('success');
    expect(engine.getContext().nodeStatuses.get('fail')).toBeUndefined();
  });

  it('false 分支：条件为假时走 false 端口', async () => {
    const { FlowEngine } = await import('../engine/FlowEngine');
    const flowData = {
      nodes: [
        { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: {} },
        {
          id: 'cond',
          type: 'conditionNode',
          position: { x: 0, y: 0 },
          data: { condition: '{{input.score}} > 80' },
        },
        { id: 'pass', type: 'endNode', position: { x: 0, y: 0 }, data: {} },
        { id: 'fail', type: 'endNode', position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'cond' },
        { id: 'e2', source: 'cond', target: 'pass', data: { sourcePort: 'true' } },
        { id: 'e3', source: 'cond', target: 'fail', data: { sourcePort: 'false' } },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const engine = new FlowEngine(flowData as never, {
      flowData: flowData as never,
      inputs: { score: 60 },
    });
    await engine.run();
    expect(engine.getContext().nodeStatuses.get('fail')).toBe('success');
    expect(engine.getContext().nodeStatuses.get('pass')).toBeUndefined();
  });

  it('无 sourcePort 的边保持原行为（无条件直连 + 条件表达式）', async () => {
    const { FlowEngine } = await import('../engine/FlowEngine');
    const flowData = {
      nodes: [
        { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: {} },
        { id: 'a', type: 'endNode', position: { x: 0, y: 0 }, data: {} },
        { id: 'b', type: 'endNode', position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'a' },
        { id: 'e2', source: 'start', target: 'b', data: { condition: '{{input.flag}} == "yes"' } },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const engine = new FlowEngine(flowData as never, {
      flowData: flowData as never,
      inputs: { flag: 'no' },
    });
    await engine.run();
    // 无条件边 a 执行；条件边 b 因条件不满足不执行（原有行为）
    expect(engine.getContext().nodeStatuses.get('a')).toBe('success');
    expect(engine.getContext().nodeStatuses.get('b')).toBeUndefined();
  });
});
