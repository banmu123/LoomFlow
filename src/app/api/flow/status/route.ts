import { NextRequest, NextResponse } from 'next/server';
import { flowRunStore } from '@/lib/tinyflow';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const flowId = request.nextUrl.searchParams.get('flowId');

  if (flowId) {
    // 查询特定流程状态
    const record = flowRunStore.get(flowId);
    if (!record) {
      return NextResponse.json(
        { error: 'Flow run not found' },
        { status: 404 }
      );
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

  // 查询所有流程
  const records = flowRunStore.getAll().map((r) => ({
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
