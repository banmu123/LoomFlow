import type { FlowNode, FlowContext } from '../types';
import { BaseExecutor } from './BaseExecutor';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';

export class EndExecutor extends BaseExecutor {
  constructor(paramResolver: ParameterResolver, exprEvaluator: ExpressionEvaluator) {
    super(paramResolver, exprEvaluator);
  }

  async execute(node: FlowNode, context: FlowContext): Promise<Record<string, unknown>> {
    // 输出定义：优先 outputDefs（AI 生成规范），兼容 parameters（早期工作流）
    const defs = node.data.outputDefs || node.data.parameters || [];
    const outputs: Record<string, unknown> = {};

    for (const param of defs) {
      const key = param.name || param.id || 'output';
      if (param.ref) {
        outputs[key] = this.paramResolver.resolve(param, context);
      } else if (param.refType === 'input') {
        outputs[key] = this.paramResolver.resolve(param, context);
      } else {
        outputs[key] = param.value ?? '';
      }
    }

    return outputs;
  }
}
