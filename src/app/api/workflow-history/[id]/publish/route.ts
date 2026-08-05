import { NextRequest } from 'next/server';
import { randomBytes } from 'crypto';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';
import { logAudit, getClientIp } from '@/lib/audit';

// 发布工作流：生成对外 API Key（已发布则轮换新 Key）
// body 可选：{ api_quota: -1 不限 | 正数限制调用次数 }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const { id } = await params;

  // 校验归属：仅工作流主人可发布
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

  const body = await request.json().catch(() => null);
  const apiQuota =
    typeof body?.api_quota === 'number' ? Math.max(-1, Math.floor(body.api_quota)) : -1;

  const apiKey = `ffk_${randomBytes(24).toString('hex')}`;

  const { data, error } = await supabase
    .from('workflow_history')
    .update({ published: true, api_key: apiKey, api_quota: apiQuota })
    .eq('id', id)
    .select('id, title, published, api_key, api_quota, api_used')
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  await logAudit({
    userId: user.id,
    username: user.username,
    action: 'workflow_publish',
    detail: { workflowId: id, title: wf.title, rotated: !!wf.api_key },
    ip: getClientIp(request),
  });

  return Response.json(data);
}
