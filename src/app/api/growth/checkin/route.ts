import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { supabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';

// POST /api/growth/checkin - 每日签到
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: '未登录' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const activity = typeof body?.activity === 'string' ? body.activity.trim() : '';
  if (!activity) return Response.json({ error: '内容不能为空' }, { status: 400 });

  const today = new Date().toISOString().slice(0, 10);
  const { data: existing } = await supabase
    .from('answer_records')
    .select('id')
    .eq('user_id', user.id)
    .eq('dimension', 'checkin')
    .gte('created_at', `${today}T00:00:00`)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return Response.json({ ok: true, message: '今天已签到' });
  }

  await supabase.from('answer_records').insert({
    user_id: user.id,
    question_id: '00000000-0000-0000-0000-000000000000',
    user_answer: activity,
    is_correct: true,
    score_gained: 2,
    dimension: 'checkin',
  });

  return Response.json({ ok: true });
}
