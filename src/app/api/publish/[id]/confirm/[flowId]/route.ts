import { NextRequest } from 'next/server';
import { getWorkflowByApiKey } from '@/lib/publish-auth';
import { flowRunStore } from '@/lib/tinyflow';
import { extractFinalOutputs } from '@/lib/tinyflow/runFlow';
import { saveFlowRun } from '@/lib/tinyflow/runFlow';
import type { FlowError } from '@/lib/tinyflow/types';

export const runtime = 'nodejs';

// 外部提交确认，继续执行流程
export async function POST(
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
  if (record.status !== 'paused') {
    return Response.json(
      { error: `Flow is not paused (current status: ${record.status})` },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => null);
  const confirmData = (body?.confirmData ?? {}) as Record<string, unknown>;

  flowRunStore.update(flowId, { status: 'running', confirmRequest: undefined });

  try {
    await record.engine.resume(confirmData);
    flowRunStore.update(flowId, { status: 'completed' });
    await saveFlowRun(flowId, { status: 'completed' });

    // 返回最终输出
    const outputs = extractFinalOutputs(auth.workflow.data, record.engine);

    return Response.json({ flowId, status: 'completed', outputs });
  } catch (err) {
    const error = err as FlowError;

    if (error.code === 'confirm_required' && error.confirmRequest) {
      flowRunStore.update(flowId, {
        status: 'paused',
        confirmRequest: error.confirmRequest,
      });
      await saveFlowRun(flowId, { status: 'paused' });
      return Response.json({
        flowId,
        status: 'paused',
        confirmRequest: error.confirmRequest,
      });
    }

    flowRunStore.update(flowId, { status: 'failed' });
    await saveFlowRun(flowId, { status: 'failed', error: error.message });
    return Response.json(
      { flowId, status: 'failed', error: error.message },
      { status: 500 },
    );
  }
}
