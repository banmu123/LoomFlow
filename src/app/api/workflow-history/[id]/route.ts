import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';
import { logAudit, getClientIp } from '@/lib/audit';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const { id } = await params;

  // 校验归属：普通用户只能删自己的
  const { data: wf } = await supabase
    .from('workflow_history')
    .select('user_id, title')
    .eq('id', id)
    .single();

  if (!wf) {
    return Response.json({ error: '记录不存在' }, { status: 404 });
  }
  if (wf.user_id !== user.id) {
    return Response.json({ error: '无权删除该记录' }, { status: 403 });
  }

  const { error } = await supabase.from('workflow_history').delete().eq('id', id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  await logAudit({
    userId: user.id,
    username: user.username,
    action: 'workflow_delete',
    detail: { workflowId: id, title: wf.title },
    ip: getClientIp(request),
  });

  return Response.json({ success: true });
}
