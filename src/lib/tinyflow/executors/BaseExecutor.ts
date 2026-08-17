import type { FlowNode, FlowContext, NodeResult, SubFlowRunner } from '../types';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';

// ===== 标准执行上下文（插件执行器契约）=====
// execute 内可访问：节点配置 / 解析后的输入 / 流程上下文 / 日志 / 执行标识 / 变量。
// 内置执行器保持 execute(node, context) 签名（向后兼容），
// 插件执行器推荐使用 createExecutorContext 组装后按此契约开发。
export interface ExecutorContext {
  /** 节点配置（node.data） */
  config: Record<string, unknown>;
  /** 解析后的输入参数 */
  inputs: Record<string, unknown>;
  /** 流程运行上下文（引擎传递） */
  flow: FlowContext;
  /** 执行 ID（流程 flowId） */
  executionId: string;
  /** 当前节点 ID */
  nodeId: string;
  /** 流程变量（跨节点共享） */
  variables: Map<string, unknown>;
  /** 日志（带流程/节点前缀） */
  logger: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

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

  /**
   * 组装标准执行上下文（供 execute 内部 / 插件执行器使用）：
   * config / inputs / flow / executionId / nodeId / variables / logger
   */
  protected createExecutorContext(node: FlowNode, context: FlowContext): ExecutorContext {
    const config = (node.data as Record<string, unknown>) || {};
    return {
      config,
      inputs: this.paramResolver.resolveList((node.data.parameters || []) as never[], context) || {},
      flow: context,
      executionId: context.flowId,
      nodeId: node.id,
      variables: context.variables,
      logger: (message: string, level: 'info' | 'warn' | 'error' = 'info') => {
        const prefix = `[flow:${context.flowId.slice(0, 8)}][node:${node.id}]`;
        if (level === 'error') console.error(prefix, message);
        else if (level === 'warn') console.warn(prefix, message);
        else console.log(prefix, message);
      },
    };
  }
}
