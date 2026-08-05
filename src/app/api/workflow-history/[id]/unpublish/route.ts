import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';
import { logAudit, getClientIp } from '@/lib/audit';

// 取消发布：吊销 API Key
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const { id } = await params;

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

  const { data, error } = await supabase
    .from('workflow_history')
    .update({ published: false, api_key: null })
    .eq('id', id)
    .select('id, title, published, api_key')
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  await logAudit({
    userId: user.id,
    username: user.username,
    action: 'workflow_unpublish',
    detail: { workflowId: id, title: wf.title },
    ip: getClientIp(request),
  });

  return Response.json(data);
}
