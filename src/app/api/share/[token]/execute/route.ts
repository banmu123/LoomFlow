import { NextRequest } from 'next/server';
import { getWorkflowByShareToken } from '@/lib/share-auth';
import { runFlow } from '@/lib/tinyflow/runFlow';
import { logAudit, getClientIp } from '@/lib/audit';

export const runtime = 'nodejs';

// 分享页试运行（token 鉴权，无需登录）
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const auth = await getWorkflowByShareToken(token);
  if (auth instanceof Response) return auth;

  const body = await request.json().catch(() => null);
  const inputs = (body?.inputs ?? {}) as Record<string, unknown>;

  await logAudit({
    action: 'share_execute',
    detail: { workflowId: auth.workflow.id },
    ip: getClientIp(request),
  });

  try {
    const result = await runFlow(auth.workflow.data, inputs, {
      source: 'api',
      workflowId: auth.workflow.id,
    });

    if (result.status === 'failed') {
      return Response.json({ status: 'failed', error: result.error }, { status: 500 });
    }
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { status: 'failed', error: (err as Error).message },
      { status: 500 },
    );
  }
}
