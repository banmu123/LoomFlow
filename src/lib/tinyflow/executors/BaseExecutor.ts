import type { FlowNode, FlowContext, NodeResult, SubFlowRunner } from '../types';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';

export abstract class BaseExecutor {
  protected paramResolver: ParameterResolver;
  protected exprEvaluator: ExpressionEvaluator;

  constructor(paramResolver: ParameterResolver, exprEvaluator: ExpressionEvaluator) {
    this.paramResolver = paramResolver;
    this.exprEvaluator = exprEvaluator;
  }

  abstract execute(
    node: FlowNode,
    context: FlowContext,
    subFlowRunner?: SubFlowRunner
  ): Promise<Record<string, unknown>>;

  /** 生成空结果 */
  protected emptyResult(): Record<string, unknown> {
    return {};
  }
}
