import { NextRequest } from 'next/server';
import { getWorkflowByApiKey } from '@/lib/publish-auth';
import { supabase } from '@/lib/supabase/server';
import { SupabaseJobQueue, jobStatusToApiStatus } from '@/lib/jobs';

export const runtime = 'nodejs';

/**
 * 取消异步任务。
 *
 * 语义：
 * - 还在排队的任务：直接 cancelled，不会被 Worker 领取；
 * - 正在执行的任务：标记 cancel_requested，Worker 轮询到后中止 FlowEngine，
 *   最终由 Worker 落为 cancelled；
 * - 已经结束的任务：返回 409，不做任何修改。
 *
 * 注意：取消无法撤回已经完成的外部副作用（HTTP 节点可能已发出请求）。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; jobId: string }> },
) {
  const { id, jobId } = await params;
  const auth = await getWorkflowByApiKey(request.headers.get('authorization'), id);
  if (auth instanceof Response) return auth;

  const queue = new SupabaseJobQueue(supabase);
  const existing = await queue.getJobById(jobId);

  if (!existing || existing.workflow_id !== id) {
    return Response.json({ error: 'Job not found' }, { status: 404 });
  }

  if (
    existing.status === 'succeeded' ||
    existing.status === 'failed' ||
    existing.status === 'cancelled' ||
    existing.status === 'dead_letter'
  ) {
    return Response.json(
      { error: `Job already finished (status: ${existing.status})` },
      { status: 409 },
    );
  }

  const job = await queue.requestCancel(jobId);
  if (!job) {
    return Response.json({ error: 'Job not found or not cancellable' }, { status: 404 });
  }

  return Response.json({
    jobId: job.id,
    status: jobStatusToApiStatus(job.status),
    jobStatus: job.status,
  });
}
