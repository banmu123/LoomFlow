import { describe, it, expect } from 'vitest';
import { ConditionExecutor } from '../executors/ConditionExecutor';
import type { FlowNode, FlowContext } from '../types';
import { GraphParser } from '../engine/GraphParser';
import { ParameterResolver } from '../engine/ParameterResolver';
import { ExpressionEvaluator } from '../engine/ExpressionEvaluator';

function makeContext(inputs: Record<string, unknown>): FlowContext {
  const flowData = {
    nodes: [{ id: 'start', type: 'startNode', data: {} }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  } as never;
  const parser = new GraphParser(flowData);
  return {
    flowId: 'test',
    inputs,
    nodeOutputs: new Map(),
    variables: new Map(),
    parser,
  } as unknown as FlowContext;
}

function makeNode(condition: string): FlowNode {
  return {
    id: 'cond1',
    type: 'conditionNode',
    position: { x: 0, y: 0 },
    data: { condition },
  } as unknown as FlowNode;
}

function makeExecutor(): ConditionExecutor {
  return new ConditionExecutor(
    new ParameterResolver(new GraphParser({ nodes: [], edges: [] } as never)),
    new ExpressionEvaluator(),
  );
}

describe('ConditionExecutor 条件节点', () => {
  it('数值比较：{{input.score}} > 80 为真 → true 端口', async () => {
    const result = await makeExecutor().execute(
      makeNode('{{input.score}} > 80'),
      makeContext({ score: 90 }),
    );
    expect(result.true).toBe(true);
    expect(result.false).toBe(false);
  });

  it('数值比较不满足 → false 端口', async () => {
    const result = await makeExecutor().execute(
      makeNode('{{input.score}} > 80'),
      makeContext({ score: 60 }),
    );
    expect(result.true).toBe(false);
    expect(result.false).toBe(true);
  });

  it('字符串包含：contains 运算符', async () => {
    const result = await makeExecutor().execute(
      makeNode('{{input.keyword}} contains "退款"'),
      makeContext({ keyword: '我要退款' }),
    );
    expect(result.true).toBe(true);
  });

  it('等值比较：== 运算符', async () => {
    const result = await makeExecutor().execute(
      makeNode('{{input.status}} == "success"'),
      makeContext({ status: 'success' }),
    );
    expect(result.true).toBe(true);
  });

  it('缺失条件表达式：validate 拒绝', () => {
    expect(makeExecutor().validate(makeNode(''))).not.toBeNull();
  });

  it('引用上游节点输出（nodeId.field）', async () => {
    const flowData = {
      nodes: [
        { id: 'n1', type: 'templateNode', data: {} },
        { id: 'cond', type: 'conditionNode', data: {} },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    } as never;
    const parser = new GraphParser(flowData);
    const ctx = {
      flowId: 'test',
      inputs: {},
      nodeOutputs: new Map([['n1', { output: 'high-score' }]]),
      variables: new Map(),
      parser,
    } as unknown as FlowContext;
    const result = await new ConditionExecutor(
      new ParameterResolver(parser),
      new ExpressionEvaluator(),
    ).execute(makeNode('{{n1.output}} contains "score"'), ctx);
    expect(result.true).toBe(true);
  });
});
