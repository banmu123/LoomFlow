import { NextRequest, NextResponse } from 'next/server';
import { scanAllRules } from '@/lib/evolution/scheduler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Vercel Cron 端点：替代内置 evolution scheduler 的 setInterval。
 *
 * 由 vercel.json crons 配置每 30 分钟调用一次。
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
    await scanAllRules();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[cron/evolution] error:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
