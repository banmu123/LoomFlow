import type { FlowNode, FlowContext } from '../types';
import { BaseExecutor } from './BaseExecutor';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';

/**
 * 条件节点：根据条件表达式决定流程分支。
 *
 * 配置（node.data.condition）：
 *   条件表达式，支持变量插值与比较运算符，如：
 *   - "{{input.score}} > 80"
 *   - "{{node1.output.status}} === \"success\""
 *   - "{{input.keyword}} contains \"退款\""
 *
 * 输出：
 *   { true: boolean, false: boolean } —— 与 NodeDefinition.outputs 的 true/false 端口对应，
 *   FlowEngine 按边上的 sourcePort（'true' / 'false'）路由下一跳。
 */
export class ConditionExecutor extends BaseExecutor {
  constructor(paramResolver: ParameterResolver, exprEvaluator: ExpressionEvaluator) {
    super(paramResolver, exprEvaluator);
  }

  validate(node: FlowNode): string | null {
    const data = node.data as Record<string, unknown>;
    if (!data.condition) return '条件节点缺少条件表达式';
    return null;
  }

  async execute(node: FlowNode, context: FlowContext): Promise<Record<string, unknown>> {
    const condition = (node.data.condition || '') as string;
    if (!condition.trim()) throw new Error('条件节点缺少条件表达式');

    // 先插值（{{var}} → 实际值），再求值
    const interpolated = this.paramResolver.interpolateTemplate(condition, context);
    const matched = this.exprEvaluator.evaluate(interpolated, context);

    return { true: matched, false: !matched };
  }
}
