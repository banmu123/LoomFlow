import { NextRequest } from 'next/server';
import { getWorkflowByApiKey } from '@/lib/publish-auth';
import { flowRunStore } from '@/lib/tinyflow';
import { extractFinalOutputs } from '@/lib/tinyflow/runFlow';

// 外部查询执行状态/结果
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; flowId: string }> },
) {
  const { id, flowId } = await params;
  const auth = await getWorkflowByApiKey(request.headers.get('authorization'), id);
  if (auth instanceof Response) return auth;

  const record = flowRunStore.get(flowId);
  if (!record) {
    return Response.json({ error: 'Flow run not found' }, { status: 404 });
  }

  // 汇总最终输出
  let outputs: Record<string, unknown> | undefined;
  if (record.status === 'completed') {
    outputs = extractFinalOutputs(auth.workflow.data, record.engine);
  }

  return Response.json({
    flowId,
    status: record.status,
    confirmRequest: record.confirmRequest,
    outputs,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}
