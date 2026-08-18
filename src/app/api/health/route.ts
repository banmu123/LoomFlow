import { NextResponse } from 'next/server';
import pkg from '../../../../package.json';

// 健康检查：部署后验证服务正常（无需登录）
// 版本号自动读取 package.json（发版只需改 package.json，避免多处不一致）
// db 字段：验证数据库连通（部署脚本与 Docker HEALTHCHECK 依赖）
export async function GET() {
  let db = 'ok';
  try {
    const { supabase } = await import('@/lib/supabase/server');
    const { error } = await supabase.from('users').select('id', { count: 'exact', head: true });
    if (error) db = `error: ${error.message}`;
  } catch (e) {
    db = `error: ${e instanceof Error ? e.message : 'unknown'}`;
  }

  return NextResponse.json({
    status: 'ok',
    service: 'loomflow',
    version: `v${pkg.version}`,
    db,
    time: new Date().toISOString(),
  });
}
