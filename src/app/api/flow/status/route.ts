import { NextRequest, NextResponse } from 'next/server';
import { flowRunStore } from '@/lib/tinyflow';
import { getCurrentUser } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  // 强制登录（安全：未认证可枚举/读取任意运行中流程的节点输出）
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const flowId = request.nextUrl.searchParams.get('flowId');

  if (flowId) {
    // 查询特定流程状态（校验归属：仅本人或 admin）
    const record = flowRunStore.get(flowId);
    if (!record) {
      return NextResponse.json(
        { error: 'Flow run not found' },
        { status: 404 }
      );
    }
    if (record.userId && record.userId !== user.id && user.role !== 'admin') {
      return NextResponse.json({ error: '无权访问该流程' }, { status: 403 });
    }

    const nodeStatuses = flowRunStore.getNodeStatuses(flowId);
    const nodeOutputs: Record<string, unknown> = {};

    for (const [nodeId, outputs] of record.context.nodeOutputs) {
      nodeOutputs[nodeId] = outputs;
    }

    return NextResponse.json({
      flowId,
      status: record.status,
      confirmRequest: record.confirmRequest,
      nodeStatuses: nodeStatuses,
      nodeOutputs,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }

  // 查询所有流程（仅本人；admin 可见全部）
  const records = flowRunStore
    .getAll()
    .filter((r) => user.role === 'admin' || !r.userId || r.userId === user.id)
    .map((r) => ({
      flowId: r.flowId,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      hasConfirmRequest: !!r.confirmRequest,
    }));

  return NextResponse.json({
    flows: records,
    total: records.length,
  });
}
