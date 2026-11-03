import { NextRequest } from 'next/server';
import { getWorkflowByApiKey } from '@/lib/publish-auth';
import { flowRunStore } from '@/lib/tinyflow';
import { extractFinalOutputs } from '@/lib/tinyflow/runFlow';
import { supabase } from '@/lib/supabase/server';
import {
  SupabaseJobQueue,
  jobStatusToApiStatus,
  type FlowJob,
} from '@/lib/jobs';

export const runtime = 'nodejs';

/** 任务状态 → 对外响应（与旧 flow run 响应字段保持兼容） */
function jobResponse(job: FlowJob): Record<string, unknown> {
  return {
    flowId: job.flow_id,
    jobId: job.id,
    status: jobStatusToApiStatus(job.status),
    jobStatus: job.status,
    attempts: job.attempts,
    maxAttempts: job.max_attempts,
    outputs: job.result ?? undefined,
    error: job.error_message ?? undefined,
    createdAt: new Date(job.created_at).getTime(),
    updatedAt: new Date(job.updated_at).getTime(),
  };
}

// 外部查询执行状态/结果
// 支持三种来源（按优先级）：
//   1. flow_jobs（异步任务，跨进程可查）
//   2. 进程内 flowRunStore（同步执行中的实时状态）
//   3. flow_runs（进程重启后的历史记录）
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; flowId: string }> },
) {
  const { id, flowId } = await params;
  const auth = await getWorkflowByApiKey(request.headers.get('authorization'), id);
  if (auth instanceof Response) return auth;

  const queue = new SupabaseJobQueue(supabase);
  const job = (await queue.getJobById(flowId)) ?? (await queue.getJobByFlowId(flowId));

  if (job) {
    if (job.workflow_id !== id) {
      return Response.json({ error: 'Flow run not found' }, { status: 404 });
    }
    return Response.json(jobResponse(job));
  }

  const record = flowRunStore.get(flowId);
  if (record) {
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

  // 进程重启后仍可查询（Worker / 其他副本产生的执行记录）
  const { data: run } = await supabase
    .from('flow_runs')
    .select('id, status, outputs, error, created_at, updated_at, job_id, trace_id')
    .eq('id', flowId)
    .maybeSingle();

  if (!run) {
    return Response.json({ error: 'Flow run not found' }, { status: 404 });
  }

  return Response.json({
    flowId: run.id,
    jobId: run.job_id ?? undefined,
    traceId: run.trace_id ?? undefined,
    status: run.status,
    outputs: run.outputs ?? undefined,
    error: run.error ?? undefined,
    createdAt: new Date(run.created_at).getTime(),
    updatedAt: new Date(run.updated_at).getTime(),
  });
}
