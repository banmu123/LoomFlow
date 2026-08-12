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

  /**
   * 校验节点配置（执行前调用，返回错误信息；null = 通过）
   * 子类可覆盖实现配置级校验
   */
  validate(_node: FlowNode): string | null {
    return null;
  }

  /** 生成空结果 */
  protected emptyResult(): Record<string, unknown> {
    return {};
  }
}
