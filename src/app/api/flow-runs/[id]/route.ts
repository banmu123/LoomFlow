import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';

export const runtime = 'nodejs';

// 执行记录详情（节点级 trace 回看）：events + flow_data + inputs/outputs + status + error
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const { id } = await params;

  const { data, error } = await supabase
    .from('flow_runs')
    .select('id, workflow_id, user_id, source, status, inputs, outputs, events, flow_data, error, created_at, updated_at')
    .eq('id', id)
    .single();

  if (error || !data) {
    return Response.json({ error: '执行记录不存在' }, { status: 404 });
  }

  // 归属校验：画布试运行（user_id 匹配）或外部调用（工作流属于该用户）
  if (data.user_id && data.user_id !== user.id) {
    return Response.json({ error: '无权查看该执行记录' }, { status: 403 });
  }

  return Response.json(data);
}
