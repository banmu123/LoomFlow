import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';

// 执行历史列表（普通用户看自己的；admin 可看全部）
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') || 50), 200);

  let query = supabase
    .from('flow_runs')
    .select('id, workflow_id, source, status, inputs, outputs, error, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (user.role !== 'admin') {
    query = query.eq('user_id', user.id);
  }

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data);
}
