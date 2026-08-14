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
