import { NextResponse } from 'next/server';
import pkg from '../../../../package.json';

// 健康检查：部署后验证服务正常（无需登录）
// 版本号自动读取 package.json（发版只需改 package.json，避免多处不一致）
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'loomflow',
    version: `v${pkg.version}`,
    time: new Date().toISOString(),
  });
}
