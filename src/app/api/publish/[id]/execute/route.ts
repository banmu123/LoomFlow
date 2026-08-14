import { NextRequest } from 'next/server';
import { getWorkflowByApiKey } from '@/lib/publish-auth';
import { runFlow } from '@/lib/tinyflow/runFlow';
import { supabase } from '@/lib/supabase/server';
import { getClientIp, logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

// 外部调用：全局 Key 鉴权（有效期校验在 publish-auth 内）+ 调用日志
// 无调用次数限制
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

  const startTime = Date.now();

  try {
    const result = await runFlow(auth.workflow.data, inputs, {
      source: 'api',
      workflowId: id,
      userId: auth.userId,
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
