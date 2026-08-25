import type { FlowNode, FlowContext, SubFlowRunner, Parameter } from '../types';
import { BaseExecutor } from './BaseExecutor';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';

export class LoopExecutor extends BaseExecutor {
  constructor(paramResolver: ParameterResolver, exprEvaluator: ExpressionEvaluator) {
    super(paramResolver, exprEvaluator);
  }

  async execute(
    node: FlowNode,
    context: FlowContext,
    subFlowRunner?: SubFlowRunner,
    signal?: AbortSignal,
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
      if (signal?.aborted) throw new Error('loop aborted');
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

      // 子节点由引擎按其 parentId 解析（subFlowRunner 传入空数组）
      if (subFlowRunner && maxLoopCount > 0) {
        await subFlowRunner([], context, {
          flowData: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
          inputs: loopContext,
          signal,
        });
      }

      // 收集循环输出
      results.push({
        index: i,
        ...loopContext,
      });

      // 等待间隔（可中止）
      if (intervalMs > 0) {
        await waitInterval(intervalMs, signal);
      }
    }

    return {
      output: results,
      loopCount: results.length,
    };
  }
}

function waitInterval(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('loop aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('loop aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
