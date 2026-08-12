import vm from 'node:vm';
import type { FlowNode, FlowContext } from '../types';
import { BaseExecutor } from './BaseExecutor';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';

// 代码节点沙箱限制
const CODE_TIMEOUT_MS = 5000; // 同步执行超时 5s

export class CodeExecutor extends BaseExecutor {
  constructor(paramResolver: ParameterResolver, exprEvaluator: ExpressionEvaluator) {
    super(paramResolver, exprEvaluator);
  }

  validate(node: FlowNode): string | null {
    const data = node.data as Record<string, unknown>;
    if (!data.code) return '代码节点缺少 code';
    return null;
  }

  async execute(node: FlowNode, context: FlowContext): Promise<Record<string, unknown>> {
    const code = node.data.code || '';
    if (!code.trim()) throw new Error('代码节点缺少代码内容');

    // 解析输入参数
    const params = node.data.parameters || [];
    const inputs = this.paramResolver.resolveList(params, context) || {};

    const outputDefs = node.data.outputDefs || [];
    const outputNames = outputDefs.map((o) => o.name || o.id || 'output');

    // ===== 沙箱执行（node:vm 隔离上下文 + 超时限制）=====
    // 用户代码只能访问 inputs / utils，无法接触 process/require/globalThis
    const sandbox: Record<string, unknown> = {
      inputs,
      utils: {
        fetch: globalThis.fetch,
        JSON,
        Math,
        String,
        Number,
        Boolean,
        Array,
        Object,
        Date,
      },
    };
    vm.createContext(sandbox);

    // code 作为函数体包装（兼容 return 语义），传入沙箱内的 inputs/utils
    const wrapped = `(function(inputs, utils){ "use strict";\n${code}\n})(inputs, utils)`;

    let finalResult: unknown;
    try {
      finalResult = vm.runInContext(wrapped, sandbox, { timeout: CODE_TIMEOUT_MS });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
        throw new Error(`代码执行超时（${CODE_TIMEOUT_MS / 1000}s 限制）`);
      }
      throw new Error(`代码执行错误: ${err.message || String(e)}`);
    }

    // 支持返回 Promise
    if (finalResult instanceof Promise) {
      finalResult = await finalResult;
    }

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
