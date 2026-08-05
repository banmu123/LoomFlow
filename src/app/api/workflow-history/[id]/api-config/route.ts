import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';
import { logAudit, getClientIp } from '@/lib/audit';

// 修改工作流 API 配额（仅工作流主人）
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

  if (typeof body?.api_quota !== 'number') {
    return Response.json({ error: 'api_quota 不能为空' }, { status: 400 });
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

  const apiQuota = Math.max(-1, Math.floor(body.api_quota));

  const { data, error } = await supabase
    .from('workflow_history')
    .update({ api_quota: apiQuota })
    .eq('id', id)
    .select('id, title, published, api_key, api_quota, api_used')
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  await logAudit({
    userId: user.id,
    username: user.username,
    action: 'workflow_api_quota',
    detail: { workflowId: id, title: wf.title, apiQuota },
    ip: getClientIp(request),
  });

  return Response.json(data);
}
