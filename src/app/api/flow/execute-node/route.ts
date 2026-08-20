import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { createExecutor, ExecutorRegistry } from '@/lib/tinyflow/executors';
import { GraphParser } from '@/lib/tinyflow/engine/GraphParser';
import { ParameterResolver } from '@/lib/tinyflow/engine/ParameterResolver';
import { ExpressionEvaluator } from '@/lib/tinyflow/engine/ExpressionEvaluator';
import type { FlowNode, FlowContext } from '@/lib/tinyflow/types';

export const runtime = 'nodejs';

// ===== 单节点运行（画布节点工具栏「运行」按钮）=====
// 只执行指定节点（不跑整个工作流），便于调试单个节点：
// - 输入：节点 data.parameters 的 defaultValue + 用户覆盖（JSON）
// - 无上游输出：ref 参数按 default/用户输入处理
// - 不落库（不污染执行历史）

// 不适合单节点运行的类型（依赖流程上下文）
const NON_EXECUTABLE = new Set(['startNode', 'endNode']);

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const node = body?.node as FlowNode | undefined;
  const inputs = (body?.inputs ?? {}) as Record<string, unknown>;

  if (!node?.id || !node?.type) {
    return Response.json({ error: '节点数据无效' }, { status: 400 });
  }
  if (NON_EXECUTABLE.has(node.type)) {
    return Response.json(
      { error: `「${node.type}」节点不适用于单节点运行，请运行整个工作流` },
      { status: 400 },
    );
  }
  if (!ExecutorRegistry.get(node.type)) {
    return Response.json(
      { error: `未注册的执行器类型: ${node.type}` },
      { status: 400 },
    );
  }

  try {
    const flowData = { nodes: [node], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    const parser = new GraphParser(flowData as never);
    const resolver = new ParameterResolver(parser);
    const evaluator = new ExpressionEvaluator();
    const executor = createExecutor(node.type, resolver, evaluator);

    // 单节点执行上下文：inputs 用用户输入（defaultValue 由前端预填），无上游输出
    const context: FlowContext = {
      flowId: `node_${Date.now()}`,
      inputs,
      nodeOutputs: new Map(),
      nodeStatuses: new Map(),
      variables: new Map(),
      userId: user.id,
    };

    const result = await Promise.race([
      executor.execute(node, context),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('节点执行超时（30s）')), 30_000),
      ),
    ]);

    return Response.json({ result, nodeId: node.id, type: node.type });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '节点执行失败';
    return Response.json({ error: msg }, { status: 500 });
  }
}
