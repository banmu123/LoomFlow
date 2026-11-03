import { NextRequest } from 'next/server';
import { getWorkflowByApiKey } from '@/lib/publish-auth';
import { runFlow } from '@/lib/tinyflow/runFlow';
import { supabase } from '@/lib/supabase/server';
import { getClientIp, logAudit } from '@/lib/audit';
import { computeHash } from '@/lib/workflow-hash';
import { SupabaseJobQueue, jobStatusToApiStatus } from '@/lib/jobs';
import { currentTraceContext } from '@/lib/telemetry';

export const runtime = 'nodejs';

// 外部调用：全局 Key 鉴权（有效期校验在 publish-auth 内）+ 调用日志
// 无调用次数限制
//
// 同步（默认）：在请求内执行并返回结果，契约不变
// 异步（body.async=true 或 X-Loomflow-Async: true）：入队后返回 202 + jobId
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await getWorkflowByApiKey(request.headers.get('authorization'), id);
  if (auth instanceof Response) return auth;

  const ip = getClientIp(request);
  const body = await request.json().catch(() => null);
  const inputs = (body?.inputs ?? {}) as Record<string, unknown>;
  const idempotencyKey =
    request.headers.get('idempotency-key') || (body?.idempotencyKey as string | undefined);
  const timeoutMs = typeof body?.timeoutMs === 'number' ? body.timeoutMs : undefined;
  const maxConcurrency = typeof body?.maxConcurrency === 'number' ? body.maxConcurrency : undefined;

  const asyncRequested =
    body?.async === true || request.headers.get('x-loomflow-async') === 'true';

  const startTime = Date.now();

  // ===== 异步：提交到持久化队列，由独立 Worker 执行 =====
  if (asyncRequested) {
    try {
      const queue = new SupabaseJobQueue(supabase);
      const { job, duplicate } = await queue.createJob({
        workflowId: id,
        userId: auth.userId,
        source: 'api',
        inputs,
        idempotencyKey: idempotencyKey ?? null,
        // 发布 API 执行「发布时快照」，入队时一并固化，避免排队期间被编辑影响
        workflowSnapshot: auth.workflow.data as unknown as Record<string, unknown>,
        workflowHash: computeHash(auth.workflow.data),
        // 把当前 HTTP 请求的 trace 上下文带给 Worker（跨进程链路）
        traceparent: currentTraceContext()?.traceparent ?? null,
      });

      await supabase.from('api_call_logs').insert({
        workflow_id: id,
        status: duplicate ? 'duplicate' : 'accepted',
        inputs,
        outputs: null,
        error: null,
        duration_ms: Date.now() - startTime,
        ip,
      });

      await logAudit({
        action: 'api_call_async',
        detail: { workflowId: id, jobId: job.id, duplicate },
        ip,
      });

      return Response.json(
        {
          jobId: job.id,
          flowId: job.flow_id,
          status: jobStatusToApiStatus(job.status),
          jobStatus: job.status,
          duplicate,
        },
        { status: duplicate ? 200 : 202 },
      );
    } catch (err) {
      return Response.json(
        { status: 'failed', error: (err as Error).message },
        { status: 500 },
      );
    }
  }

  // ===== 同步：保持原有行为 =====
  try {
    const result = await runFlow(auth.workflow.data, inputs, {
      source: 'api',
      workflowId: id,
      userId: auth.userId,
      idempotencyKey,
      timeoutMs,
      maxConcurrency,
      signal: request.signal,
    });

    // 记录调用日志
    await supabase.from('api_call_logs').insert({
      workflow_id: id,
      status: result.status === 'failed' ? 'failed' : 'success',
      inputs,
      outputs: result.outputs || null,
      error: result.error || null,
      duration_ms: Date.now() - startTime,
      ip,
    });

    await logAudit({
      action: 'api_call',
      detail: { workflowId: id, status: result.status, durationMs: Date.now() - startTime },
      ip,
    });

    if (result.status === 'failed' || result.status === 'timeout' || result.status === 'cancelled') {
      return Response.json(
        { status: result.status, error: result.error },
        { status: 500 },
      );
    }
    return Response.json(result);
  } catch (err) {
    // 执行异常也记录
    await supabase.from('api_call_logs').insert({
      workflow_id: id,
      status: 'failed',
      inputs,
      error: (err as Error).message,
      duration_ms: Date.now() - startTime,
      ip,
    });
    return Response.json(
      { status: 'failed', error: (err as Error).message },
      { status: 500 },
    );
  }
}
