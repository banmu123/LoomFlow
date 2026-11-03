import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { supabase } from '@/lib/supabase/server';
import { SupabaseJobQueue, jobStatusToApiStatus } from '@/lib/jobs';
import { logAudit, getClientIp } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * 手动重试死信/失败任务（登录用户，仅限自己的任务；管理员可操作全部）。
 * 会把任务重新置为 queued，并保证至少还能再执行一次。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const { id } = await params;
  const queue = new SupabaseJobQueue(supabase);
  const job = await queue.getJobById(id);

  if (!job) {
    return Response.json({ error: '任务不存在' }, { status: 404 });
  }

  const isOwner = job.user_id === user.id;
  if (!isOwner && user.role !== 'admin') {
    return Response.json({ error: '无权操作该任务' }, { status: 403 });
  }

  if (!['dead_letter', 'failed', 'cancelled'].includes(job.status)) {
    return Response.json(
      { error: `只有失败/死信任务可以手动重试（当前状态：${job.status}）` },
      { status: 409 },
    );
  }

  const requeued = await queue.retryJob(id);
  if (!requeued) {
    return Response.json({ error: '任务重试失败（状态已变化）' }, { status: 409 });
  }

  await logAudit({
    userId: user.id,
    username: user.username,
    action: 'flow_job_retry',
    detail: { jobId: id, previousStatus: job.status },
    ip: getClientIp(request),
  });

  return Response.json({
    jobId: requeued.id,
    status: jobStatusToApiStatus(requeued.status),
    jobStatus: requeued.status,
  });
}
