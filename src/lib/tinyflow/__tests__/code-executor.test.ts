import { describe, it, expect } from 'vitest';
import { CodeExecutor } from '../executors/CodeExecutor';
import type { FlowNode, FlowContext } from '../types';
import { GraphParser } from '../engine/GraphParser';
import { ParameterResolver } from '../engine/ParameterResolver';
import { ExpressionEvaluator } from '../engine/ExpressionEvaluator';

function makeContext(): FlowContext {
  const flowData = {
    nodes: [{ id: 'start', type: 'startNode', data: {} }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  } as never;
  const parser = new GraphParser(flowData);
  return {
    flowId: 'test',
    inputs: {},
    nodeOutputs: new Map(),
    variables: {},
    parser,
  } as unknown as FlowContext;
}

function makeNode(code: string): FlowNode {
  return {
    id: 'code1',
    type: 'codeNode',
    position: { x: 0, y: 0 },
    data: { code, outputDefs: [{ id: 'o1', name: 'result' }] },
  } as unknown as FlowNode;
}

describe('CodeExecutor 沙箱', () => {
  it('正常执行算术代码', async () => {
    const executor = new CodeExecutor(
      new ParameterResolver(new GraphParser({ nodes: [], edges: [] } as never)),
      new ExpressionEvaluator(),
    );
    const result = await executor.execute(makeNode('return 41 + 1;'), makeContext());
    expect(result.result).toBe(42);
  });

  it('沙箱内提供 fetch / JSON 等工具', async () => {
    const executor = new CodeExecutor(
      new ParameterResolver(new GraphParser({ nodes: [], edges: [] } as never)),
      new ExpressionEvaluator(),
    );
    const result = await executor.execute(makeNode('return typeof utils.fetch + ":" + typeof JSON.parse;'), makeContext());
    expect(result.result).toBe('function:function');
  });

  it('无法访问 process（沙箱隔离）', async () => {
    const executor = new CodeExecutor(
      new ParameterResolver(new GraphParser({ nodes: [], edges: [] } as never)),
      new ExpressionEvaluator(),
    );
    // typeof 在隔离上下文中安全返回 'undefined'（process 不存在）
    const result = await executor.execute(makeNode('return typeof process;'), makeContext());
    expect(result.result).toBe('undefined');
  });

  it('死循环触发超时限制', async () => {
    const executor = new CodeExecutor(
      new ParameterResolver(new GraphParser({ nodes: [], edges: [] } as never)),
      new ExpressionEvaluator(),
    );
    await expect(
      executor.execute(makeNode('while(true) {} return 1;'), makeContext()),
    ).rejects.toThrow('超时');
  }, 10000);

  it('无法访问 require（沙箱隔离）', async () => {
    const executor = new CodeExecutor(
      new ParameterResolver(new GraphParser({ nodes: [], edges: [] } as never)),
      new ExpressionEvaluator(),
    );
    const result = await executor.execute(makeNode('return typeof require;'), makeContext());
    expect(result.result).toBe('undefined');
  });

  it('validate：缺少 code 拒绝', () => {
    const executor = new CodeExecutor(
      new ParameterResolver(new GraphParser({ nodes: [], edges: [] } as never)),
      new ExpressionEvaluator(),
    );
    const node = makeNode('');
    expect(executor.validate(node)).not.toBeNull();
  });
});
