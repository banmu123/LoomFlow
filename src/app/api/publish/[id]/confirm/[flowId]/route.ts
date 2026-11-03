import { NextRequest } from 'next/server';
import { getWorkflowByApiKey } from '@/lib/publish-auth';
import { flowRunStore } from '@/lib/tinyflow';
import { extractFinalOutputs } from '@/lib/tinyflow/runFlow';
import { saveFlowRun } from '@/lib/tinyflow/runFlow';
import { supabase } from '@/lib/supabase/server';
import { SupabaseJobQueue } from '@/lib/jobs';
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

  // 异步任务由 Worker 进程执行，引擎实例不在本进程内，无法跨进程恢复暂停点。
  // 明确报错而不是静默失败：确认类工作流请使用同步执行。
  const queue = new SupabaseJobQueue(supabase);
  const job = (await queue.getJobById(flowId)) ?? (await queue.getJobByFlowId(flowId));
  if (job) {
    return Response.json(
      {
        error:
          '异步任务暂不支持人工确认：执行引擎运行在 Worker 进程中，无法跨进程恢复。请改用同步执行（不传 async）。',
        jobId: job.id,
        jobStatus: job.status,
      },
      { status: 409 },
    );
  }

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
