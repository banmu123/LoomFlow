import { NextResponse } from 'next/server';

// 健康检查：部署后验证服务正常（无需登录）
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'loomflow',
    version: 'v0.1.0',
    time: new Date().toISOString(),
  });
}
