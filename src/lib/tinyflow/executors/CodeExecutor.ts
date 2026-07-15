import type { FlowNode, FlowContext } from '../types';
import { BaseExecutor } from './BaseExecutor';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';

export class CodeExecutor extends BaseExecutor {
  constructor(paramResolver: ParameterResolver, exprEvaluator: ExpressionEvaluator) {
    super(paramResolver, exprEvaluator);
  }

  async execute(node: FlowNode, context: FlowContext): Promise<Record<string, unknown>> {
    const code = node.data.code || '';
    if (!code.trim()) throw new Error('代码节点缺少代码内容');

    // 解析输入参数
    const params = node.data.parameters || [];
    const inputs = this.paramResolver.resolveList(params, context);

    // 在沙箱中执行用户代码
    const outputDefs = node.data.outputDefs || [];
    const outputNames = outputDefs.map((o) => o.name || o.id || 'output');

    // 构造安全的执行环境
    const fn = new Function(
      'inputs',
      'utils',
      `"use strict";\n${code}`
    );

    const utils = {
      fetch: globalThis.fetch,
      JSON,
      Date,
      Math,
      String,
      Number,
      Boolean,
      Array,
      Object,
    };

    const result = fn(inputs, utils);

    // 如果返回 Promise, 等待
    const finalResult = result instanceof Promise ? await result : result;

    // 构造输出
    if (outputNames.length === 0) {
      return { output: finalResult };
    }

    if (outputNames.length === 1) {
      return { [outputNames[0]]: finalResult };
    }

    // 多个输出: 期望返回对象
    if (typeof finalResult === 'object' && finalResult !== null) {
      return finalResult as Record<string, unknown>;
    }

    return { output: finalResult };
  }
}
