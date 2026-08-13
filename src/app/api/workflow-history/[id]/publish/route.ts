import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';
import { logAudit, getClientIp } from '@/lib/audit';
import { ensureUserApiKey } from '@/lib/api-key';

// 发布工作流：标记 published=true。
// 全局 API Key 在首次发布时自动生成，仅在生成当次响应中返回（只显示一次）；
// 已生成过 Key 的用户再次发布不返回 Key。
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

  // 确保全局 API Key 存在（有效期配置仅在首次生成时生效）
  const { created, api_key } = await ensureUserApiKey(user.id, {
    expires_days: typeof body?.expires_days === 'number' ? body.expires_days : undefined,
  });

  const { data, error } = await supabase
    .from('workflow_history')
    .update({ published: true })
    .eq('id', id)
    .select('id, title, published')
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  await logAudit({
    userId: user.id,
    username: user.username,
    action: 'workflow_publish',
    detail: { workflowId: id, title: wf.title, apiKeyCreated: created },
    ip: getClientIp(request),
  });

  // api_key 仅在首次生成时非空（只显示一次）
  return Response.json({ ...data, api_key: created ? api_key : null });
}
