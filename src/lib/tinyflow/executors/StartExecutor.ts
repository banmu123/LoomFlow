import type { FlowNode, FlowContext } from '../types';
import { BaseExecutor } from './BaseExecutor';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';

export class StartExecutor extends BaseExecutor {
  constructor(paramResolver: ParameterResolver, exprEvaluator: ExpressionEvaluator) {
    super(paramResolver, exprEvaluator);
  }

  async execute(node: FlowNode, context: FlowContext): Promise<Record<string, unknown>> {
    const params = node.data.parameters;
    const inputs = this.paramResolver.resolveList(params, context);
    return inputs;
  }
}
