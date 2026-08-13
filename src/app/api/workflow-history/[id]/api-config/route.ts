import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';
import { logAudit, getClientIp } from '@/lib/audit';

// 修改工作流 API 配置：配额 + Key 有效期（仅工作流主人）
// body：{ api_quota?: -1 不限 | 正数, expires_days?: 0 永不过期 | N 天 }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);

  if (typeof body?.api_quota !== 'number' && typeof body?.expires_days !== 'number') {
    return Response.json({ error: 'api_quota 或 expires_days 至少一项' }, { status: 400 });
  }

  const { data: wf } = await supabase
    .from('workflow_history')
    .select('id, user_id, title')
    .eq('id', id)
    .single();

  if (!wf) {
    return Response.json({ error: '工作流不存在' }, { status: 404 });
  }
  if (wf.user_id !== user.id) {
    return Response.json({ error: '无权操作该工作流' }, { status: 403 });
  }

  const updates: Record<string, unknown> = {};

  if (typeof body.api_quota === 'number') {
    updates.api_quota = Math.max(-1, Math.floor(body.api_quota));
  }
  if (typeof body.expires_days === 'number') {
    // 0 = 永不过期；N = N 天后过期
    updates.api_key_expires_at =
      body.expires_days > 0
        ? new Date(Date.now() + body.expires_days * 24 * 3600 * 1000).toISOString()
        : null;
  }

  const { data, error } = await supabase
    .from('workflow_history')
    .update(updates)
    .eq('id', id)
    .select('id, title, published, api_key, api_quota, api_used, api_key_expires_at')
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  await logAudit({
    userId: user.id,
    username: user.username,
    action: 'workflow_api_config',
    detail: { workflowId: id, title: wf.title, updates: Object.keys(updates) },
    ip: getClientIp(request),
  });

  return Response.json(data);
}
