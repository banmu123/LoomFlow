import type { FlowNode, FlowContext, FlowError } from '../types';
import { BaseExecutor } from './BaseExecutor';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';

export class ConfirmExecutor extends BaseExecutor {
  constructor(paramResolver: ParameterResolver, exprEvaluator: ExpressionEvaluator) {
    super(paramResolver, exprEvaluator);
  }

  async execute(node: FlowNode, _context: FlowContext): Promise<Record<string, unknown>> {
    const confirms = node.data.confirms || [];

    // 抛出确认请求错误, 引擎会暂停执行
    const error = new Error('confirm_required') as FlowError;
    error.code = 'confirm_required';
    error.confirmRequest = {
      type: 'confirm_required',
      nodeId: node.id,
      message: node.data.message || '请确认以下信息',
      confirms: confirms.map((c) => ({
        name: c.name,
        formType: c.formType,
        formLabel: c.formLabel,
        formDescription: c.formDescription,
        enums: c.enums,
        contentType: c.contentType,
        required: c.required,
      })),
    };
    error.nodeId = node.id;
    throw error;
  }
}
