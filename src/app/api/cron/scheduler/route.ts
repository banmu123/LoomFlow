import { NextRequest, NextResponse } from 'next/server';
import { reloadSchedules, executeSchedule } from '@/lib/scheduler';
import { supabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Vercel Cron 端点：替代内置 scheduler 的 setInterval。
 *
 * 由 vercel.json crons 配置每 10 分钟调用一次。
 * Docker 模式下不使用此端点（scheduler 内置于 server.ts）。
 */
export async function GET(request: NextRequest) {
  // 验证 Cron Secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 重新加载所有启用的定时任务
    await reloadSchedules();

    // 查询并执行到期的任务
    const { data: schedules } = await supabase
      .from('scheduled_runs')
      .select('*')
      .eq('enabled', true);

    let executed = 0;
    if (schedules) {
      for (const schedule of schedules) {
        try {
          await executeSchedule(schedule);
          executed++;
        } catch {
          // 单个任务失败不阻塞其他任务
        }
      }
    }

    return NextResponse.json({ ok: true, executed });
  } catch (err) {
    console.error('[cron/scheduler] error:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
