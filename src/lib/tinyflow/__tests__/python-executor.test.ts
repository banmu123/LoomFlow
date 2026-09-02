import { describe, it, expect } from 'vitest';
import { CodeExecutor } from '../executors/CodeExecutor';
import { runPythonCode, PYTHON_TIMEOUT_MS } from '../executors/PythonSandbox';
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

function makePythonNode(code: string, outputDefs: Array<{ id: string; name: string }> = []): FlowNode {
  return {
    id: 'code1',
    type: 'codeNode',
    position: { x: 0, y: 0 },
    data: { code, engine: 'python', outputDefs },
  } as unknown as FlowNode;
}

function makeExecutor(): CodeExecutor {
  return new CodeExecutor(
    new ParameterResolver(new GraphParser({ nodes: [], edges: [] } as never)),
    new ExpressionEvaluator(),
  );
}

// ===== PythonSandbox 单元（runPythonCode 直调，覆盖输入注入等执行器层不可达的路径）=====

describe('PythonSandbox', () => {
  it('基础执行：函数体 return 语义 + 标准库可用', async () => {
    const result = (await runPythonCode(
      "import math\nreturn {'r': math.floor(3.7), 'upper': 'abc'.upper()}",
      '{}',
    )) as { r: number; upper: string };
    expect(result.r).toBe(3);
    expect(result.upper).toBe('ABC');
  }, 30000);

  it('inputs 注入：JSON 字典（含嵌套结构）', async () => {
    const result = (await runPythonCode(
      "return {'name': inputs['user']['name'].upper(), 'total': inputs['nums'][0] + inputs['nums'][1]}",
      JSON.stringify({ user: { name: 'loom' }, nums: [20, 22] }),
    )) as { name: string; total: number };
    expect(result.name).toBe('LOOM');
    expect(result.total).toBe(42);
  }, 30000);

  it('Python 异常上抛且含真实错误', async () => {
    await expect(runPythonCode('return 1 / 0', '{}')).rejects.toThrow(/ZeroDivisionError/);
  }, 30000);

  it('死循环触发超时（worker 强杀）', async () => {
    await expect(runPythonCode('while True:\n    pass', '{}', 600)).rejects.toThrow('超时');
    // 强杀后沙箱可自愈：再次执行正常
    const recovered = await runPythonCode('return 7 * 6', '{}');
    expect(recovered).toEqual(42);
  }, 30000);

  it('非序列化返回值走 default=str 兜底不炸', async () => {
    const result = (await runPythonCode(
      "import datetime\nreturn {'now': datetime.datetime(2026, 1, 1, 0, 0, 0)}",
      '{}',
    )) as { now: string };
    expect(typeof result.now).toBe('string');
  }, 30000);
});

// ===== CodeExecutor 引擎分支集成 =====

describe('CodeExecutor engine=python', () => {
  it('engine=python 走 Pyodide 执行', async () => {
    const executor = makeExecutor();
    const result = await executor.execute(
      makePythonNode("return {'hello': 'world', 'n': 6 * 7}", [{ id: 'o1', name: 'result' }]),
      makeContext(),
    );
    expect(result.result).toEqual({ hello: 'world', n: 42 });
  }, 30000);

  it('engine=python 多输出定义：期望返回对象', async () => {
    const executor = makeExecutor();
    const result = await executor.execute(
      makePythonNode(
        "return {'a': 1, 'b': 2}",
        [
          { id: 'o1', name: 'a' },
          { id: 'o2', name: 'b' },
        ],
      ),
      makeContext(),
    );
    expect(result).toEqual({ a: 1, b: 2 });
  }, 30000);

  it('engine 缺省/遗留值（qlexpress/groovy）保持 JS 沙箱行为', async () => {
    const executor = makeExecutor();
    const node = {
      id: 'code1',
      type: 'codeNode',
      position: { x: 0, y: 0 },
      data: { code: 'return 41 + 1;', engine: 'qlexpress', outputDefs: [{ id: 'o1', name: 'result' }] },
    } as unknown as FlowNode;
    const result = await executor.execute(node, makeContext());
    expect(result.result).toBe(42);
  }, 30000);
});

// 防止 PYTHON_TIMEOUT_MS 意外变更（沙箱预算与 JS 保持一致的回归锚点）
describe('Python 沙箱预算', () => {
  it('默认超时与 JS 沙箱一致（5s）', () => {
    expect(PYTHON_TIMEOUT_MS).toBe(5000);
  });
});
