import type { FlowNode, FlowContext } from '../types';
import { BaseExecutor } from './BaseExecutor';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';

export class TemplateExecutor extends BaseExecutor {
  constructor(paramResolver: ParameterResolver, exprEvaluator: ExpressionEvaluator) {
    super(paramResolver, exprEvaluator);
  }

  async execute(node: FlowNode, context: FlowContext): Promise<Record<string, unknown>> {
    const template = node.data.template || '';
    if (!template) throw new Error('模板节点缺少模板内容');

    const rendered = this.paramResolver.interpolateTemplate(template, context);
    return { output: rendered };
  }
}
