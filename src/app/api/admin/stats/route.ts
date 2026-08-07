import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/server-auth';

// 用量统计（仅 admin）
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const days = Math.min(Number(request.nextUrl.searchParams.get('days') || 7), 30);

  const [users, conversations, messages, workflows, runs, apiCalls] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }),
    supabase.from('conversations').select('id', { count: 'exact', head: true }),
    supabase.from('messages').select('id', { count: 'exact', head: true }),
    supabase
      .from('workflow_history')
      .select('id', { count: 'exact', head: true })
      .eq('saved', true),
    supabase.from('flow_runs').select('id, status', { count: 'exact', head: false }),
    supabase
      .from('api_call_logs')
      .select('id', { count: 'exact', head: true }),
  ]);

  // 近 N 天每日对话创建数
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  since.setHours(0, 0, 0, 0);

  const { data: dailyConvs } = await supabase
    .from('conversations')
    .select('created_at')
    .gte('created_at', since.toISOString());

  const dailyMap = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    dailyMap.set(d.toISOString().slice(0, 10), 0);
  }
  dailyConvs?.forEach((c: { created_at: string }) => {
    const day = c.created_at.slice(0, 10);
    if (dailyMap.has(day)) dailyMap.set(day, dailyMap.get(day)! + 1);
  });

  const dailyConversations = [...dailyMap.entries()].map(([date, count]) => ({
    date,
    count,
  }));

  const runStatus = (runs.data || []).reduce(
    (acc: Record<string, number>, r: { status: string }) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return Response.json({
    totals: {
      users: users.count ?? 0,
      conversations: conversations.count ?? 0,
      messages: messages.count ?? 0,
      workflows: workflows.count ?? 0,
      flowRuns: runs.count ?? 0,
      apiCalls: apiCalls.count ?? 0,
    },
    runStatus,
    dailyConversations,
  });
}
