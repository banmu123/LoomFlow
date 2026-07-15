import type { FlowNode, FlowContext, SubFlowRunner, Parameter } from '../types';
import { BaseExecutor } from './BaseExecutor';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';
import type { FlowEngine } from '../engine/FlowEngine';

export class LoopExecutor extends BaseExecutor {
  constructor(paramResolver: ParameterResolver, exprEvaluator: ExpressionEvaluator) {
    super(paramResolver, exprEvaluator);
  }

  async execute(
    node: FlowNode,
    context: FlowContext,
    subFlowRunner?: SubFlowRunner
  ): Promise<Record<string, unknown>> {
    const data = node.data;

    if (!data.loopEnable) {
      return { output: [] };
    }

    const intervalMs = Number(data.loopIntervalMs || 0);
    const maxLoopCount = Number(data.maxLoopCount || 1);
    const breakCondition = data.loopBreakCondition || '';

    // 解析循环变量
    const loopVars = data.loopVars || [];
    const loopInputs = this.paramResolver.resolveList(loopVars, context);

    const results: unknown[] = [];

    for (let i = 0; i < maxLoopCount; i++) {
      // 检查中断条件
      if (breakCondition) {
        const shouldBreak = this.exprEvaluator.evaluate(breakCondition, context);
        if (shouldBreak) break;
      }

      // 将循环变量写入 context
      const loopContext: Record<string, unknown> = {
        ...loopInputs,
        loopIndex: i,
        loopCount: i + 1,
      };

      // 如果有子节点, 执行子流程
      if (subFlowRunner) {
        // 获取子节点
        const engine = this.getEngine();
        if (engine) {
          const childNodes = (engine as unknown as {
            parser: { getChildren: (id: string) => FlowNode[] };
          }).parser.getChildren(node.id);

          if (childNodes.length > 0) {
            await subFlowRunner(childNodes, context, {
              flowData: { nodes: childNodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
              inputs: loopContext,
              signal: undefined,
              onNodeStart: undefined,
              onNodeComplete: undefined,
            });
          }
        }
      }

      // 收集循环输出
      results.push({
        index: i,
        ...loopContext,
      });

      // 等待间隔
      if (intervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }

    return {
      output: results,
      loopCount: results.length,
    };
  }

  private engineRef: FlowEngine | null = null;

  private getEngine(): FlowEngine | null {
    return this.engineRef;
  }
}
