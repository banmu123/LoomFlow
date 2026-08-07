import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/server-auth';

// 审计日志列表（仅 admin）
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') || 100), 500);
  const action = request.nextUrl.searchParams.get('action') || null;

  let query = supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (action) {
    query = query.eq('action', action);
  }

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data);
}
