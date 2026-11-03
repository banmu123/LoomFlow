import type { FlowNode, FlowContext } from '../types';
import { BaseExecutor } from './BaseExecutor';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';
import { executeCode } from '@/lib/sandbox';

// 代码节点执行预算（与历史行为一致：5s）
const CODE_TIMEOUT_MS = 5000;

/**
 * 代码节点执行器。
 *
 * 这里只负责「解析输入 → 交给沙箱适配层 → 映射输出」，
 * 真正的隔离由 @/lib/sandbox 决定（容器沙箱 / 显式启用的 vm / Pyodide）。
 */
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

    // 画布 UI 可选 js / python / groovy / qlexpress（后两者为模板遗留选项），
    // 非 python 一律按 JS 执行（历史行为：engine 字段此前从未被后端消费）
    const engine = typeof node.data.engine === 'string' ? node.data.engine.toLowerCase() : 'js';

    const finalResult = await executeCode({
      language: engine === 'python' ? 'python' : 'javascript',
      code,
      inputs: inputs as Record<string, unknown>,
      timeoutMs: CODE_TIMEOUT_MS,
    });

    return mapCodeOutputs(finalResult, outputNames);
  }
}

/** 输出映射：与 JS/Python 引擎共用（0 个 → {output}；1 个 → {name: value}；多个 → 期望返回对象） */
function mapCodeOutputs(
  finalResult: unknown,
  outputNames: string[],
): Record<string, unknown> {
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
