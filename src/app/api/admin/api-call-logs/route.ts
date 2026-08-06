import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/server-auth';

// API 调用日志列表（仅 admin）
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') || 100), 500);
  const workflowId = request.nextUrl.searchParams.get('workflowId') || null;

  let query = supabase
    .from('api_call_logs')
    .select('*, workflow_history(title)')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (workflowId) {
    query = query.eq('workflow_id', workflowId);
  }

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data);
}
