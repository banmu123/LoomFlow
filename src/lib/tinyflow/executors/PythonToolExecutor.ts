import type { FlowNode, FlowContext } from '../types';
import { BaseExecutor } from './BaseExecutor';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';
import {
  PYTHON_TOOL_NAMES,
  callPythonTool,
  type PythonToolName,
} from '@/lib/python-tools';

/**
 * Python 工具节点：调用独立的 services/agent-tools 服务。
 *
 * 边界：
 * - 只传 JSON 参数，不在本地执行任何 Python 代码
 * - 服务不可用时抛错（FlowEngine 记录失败），不静默降级
 * - 超时由执行器与服务端双重约束
 */
export class PythonToolExecutor extends BaseExecutor {
  constructor(paramResolver: ParameterResolver, exprEvaluator: ExpressionEvaluator) {
    super(paramResolver, exprEvaluator);
  }

  validate(node: FlowNode): string | null {
    const data = node.data as Record<string, unknown>;
    const tool = typeof data.tool === 'string' ? data.tool : '';
    if (!tool) return 'Python 工具节点未选择工具';
    if (!PYTHON_TOOL_NAMES.includes(tool as PythonToolName)) {
      return `未知的 Python 工具：${tool}`;
    }
    return null;
  }

  async execute(node: FlowNode, context: FlowContext): Promise<Record<string, unknown>> {
    const data = node.data;
    const tool = String(data.tool ?? '') as PythonToolName;
    if (!PYTHON_TOOL_NAMES.includes(tool)) {
      throw new Error(`未知的 Python 工具：${tool}`);
    }

    const payload = this.buildPayload(data, context);
    const timeoutMs = Math.min(Math.max(Number(data.timeoutMs) || 25_000, 1000), 60_000);

    const result = await callPythonTool(tool, payload, { timeoutMs });

    return {
      // output：工具返回的 data（下游用 {{nodeId.output.xxx}} 引用）
      output: result.data,
      data: result.data,
      metadata: result.metadata,
      tool,
    };
  }

  /** 组装请求体：params(JSON) 为基底，input(模板) 映射为 content */
  private buildPayload(
    data: Record<string, unknown>,
    context: FlowContext,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {};

    const rawParams = typeof data.params === 'string' ? data.params.trim() : '';
    if (rawParams) {
      const interpolated = this.paramResolver.interpolateTemplate(rawParams, context);
      let parsed: unknown;
      try {
        parsed = JSON.parse(interpolated);
      } catch {
        throw new Error('Python 工具节点的 params 不是合法 JSON（支持 {{节点.字段}} 插值）');
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Python 工具节点的 params 必须是 JSON 对象');
      }
      Object.assign(payload, parsed as Record<string, unknown>);
    }

    const rawInput = typeof data.input === 'string' ? data.input : '';
    if (rawInput.trim() && payload.content === undefined && payload.content_base64 === undefined) {
      payload.content = this.paramResolver.interpolateTemplate(rawInput, context);
    }

    return payload;
  }
}
