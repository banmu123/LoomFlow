import { NextRequest, NextResponse } from 'next/server';
import { runScheduledTasks } from '@/lib/scheduler/cron-runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Vercel Cron 端点：统一调度入口。
 *
 * Vercel Hobby 计划仅支持每天一次 Cron，因此：
 * - 每天触发一次
 * - 由 cron-runner 根据 last_run_at 和 frequency 判断哪些任务到期
 * - 同时触发 evolution checks
 *
 * Docker 模式下不使用此端点（scheduler 内置于 server.ts）。
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runScheduledTasks();
    return NextResponse.json({ success: true, executed: result.executed, skipped: result.skipped });
  } catch (err) {
    console.error('[cron/scheduler] error:', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
