import { NextResponse } from 'next/server';
import { getOSSConfig } from '@/lib/oss-config';
import { getCurrentUser } from '@/lib/server-auth';

/**
 * GET /api/oss/config
 * 获取 OSS 配置（数据库「存储设置」优先，其次环境变量）
 * 仅登录用户可访问（避免密钥明文泄露给未授权方）
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  try {
    const config = await getOSSConfig();

    if (!config) {
      return NextResponse.json(
        {
          error: 'OSS 配置未设置',
          isComplete: false,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ...config,
      isComplete: true,
    });
  } catch (error) {
    console.error('获取 OSS 配置失败:', error);
    return NextResponse.json(
      { error: '获取配置失败', isComplete: false },
      { status: 500 }
    );
  }
}
