import { NextRequest } from 'next/server';
import { getWorkflowByApiKey } from '@/lib/publish-auth';
import { runFlow } from '@/lib/tinyflow/runFlow';
import { supabase } from '@/lib/supabase/server';
import { getClientIp, logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

// 外部调用：配额校验 + 调用日志 + 同步/异步返回
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

  // 查询工作流配额信息
  const { data: wf } = await supabase
    .from('workflow_history')
    .select('api_quota, api_used')
    .eq('id', id)
    .single();

  const apiQuota = wf?.api_quota ?? -1;
  const apiUsed = wf?.api_used ?? 0;

  // 配额校验（-1 不限）
  if (apiQuota !== -1 && apiUsed >= apiQuota) {
    await logAudit({
      action: 'api_call',
      detail: { workflowId: id, status: 'quota_exceeded', used: apiUsed, quota: apiQuota },
      ip,
    });
    return Response.json(
      { error: `API 调用次数已达上限（${apiQuota} 次），请联系管理员` },
      { status: 429 },
    );
  }

  // 扣减配额（-1 不限时不扣）
  if (apiQuota !== -1) {
    await supabase
      .from('workflow_history')
      .update({ api_used: apiUsed + 1 })
      .eq('id', id);
  }

  const startTime = Date.now();

  try {
    const result = await runFlow(auth.workflow.data, inputs, {
      source: 'api',
      workflowId: id,
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

    if (result.status === 'failed') {
      return Response.json(
        { status: 'failed', error: result.error },
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
