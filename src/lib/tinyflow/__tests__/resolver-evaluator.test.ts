import { describe, it, expect } from 'vitest';
import { ParameterResolver } from '../engine/ParameterResolver';
import { ExpressionEvaluator } from '../engine/ExpressionEvaluator';
import { GraphParser } from '../engine/GraphParser';
import type { FlowContext, Parameter } from '../types';

function makeContext(overrides: Partial<FlowContext> = {}): FlowContext {
  const parser = new GraphParser({ nodes: [], edges: [] } as never);
  return {
    flowId: 'test',
    inputs: {},
    nodeOutputs: new Map(),
    variables: {},
    parser,
    ...overrides,
  } as unknown as FlowContext;
}

describe('ParameterResolver', () => {
  it('fixed 类型参数按 dataType 转换', () => {
    const resolver = new ParameterResolver(new GraphParser({ nodes: [], edges: [] } as never));
    const params: Parameter[] = [
      { id: 'p1', name: 'num', refType: 'fixed', dataType: 'number', value: '42' },
      { id: 'p2', name: 'bool', refType: 'fixed', dataType: 'boolean', value: 'true' },
      { id: 'p3', name: 'str', refType: 'fixed', dataType: 'String', value: 'hello' },
    ];
    const result = resolver.resolveList(params, makeContext());
    expect(result.num).toBe(42);
    expect(result.bool).toBe(true);
    expect(result.str).toBe('hello');
  });

  it('input 类型参数从上下文输入解析', () => {
    const resolver = new ParameterResolver(new GraphParser({ nodes: [], edges: [] } as never));
    const params: Parameter[] = [
      { id: 'p1', name: 'query', refType: 'input', dataType: 'String' },
    ];
    const result = resolver.resolveList(params, makeContext({ inputs: { query: '你好' } }));
    expect(result.query).toBe('你好');
  });

  it('模板插值支持 ${path} 占位', () => {
    const resolver = new ParameterResolver(new GraphParser({ nodes: [], edges: [] } as never));
    const ctx = makeContext({
      nodeOutputs: new Map([['node_a', { output: '世界' }]]),
    });
    const rendered = resolver.interpolateTemplate('你好，{{node_a.output}}', ctx);
    expect(rendered).toBe('你好，世界');
  });
});

describe('ExpressionEvaluator', () => {
  it('布尔表达式求值', () => {
    const evaluator = new ExpressionEvaluator();
    const ctx = makeContext();
    expect(evaluator.evaluate('1 < 2', ctx)).toBe(true);
    expect(evaluator.evaluate('"a" == "a"', ctx)).toBe(true);
    expect(evaluator.evaluate('2 > 3', ctx)).toBe(false);
  });

  it('支持变量引用', () => {
    const evaluator = new ExpressionEvaluator((name) =>
      name === 'status' ? 'success' : undefined,
    );
    const ctx = makeContext();
    expect(evaluator.evaluate('status == "success"', ctx)).toBe(true);
  });
});
