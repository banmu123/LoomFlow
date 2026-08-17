import { NextResponse } from 'next/server';
import { getOSSConfig } from '@/lib/oss-config';
import { getCurrentUser } from '@/lib/server-auth';

/**
 * GET /api/oss/config
 * 获取 OSS 配置状态（仅返回是否已配置与 bucket/region——**不返回任何密钥**）
 * 文件上传走服务端代理（/api/oss/upload），AccessKeySecret 永不下发客户端
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

    // 安全：只返回非敏感字段
    return NextResponse.json({
      isComplete: true,
      bucket: config.bucket,
      region: config.region,
      endpoint: config.endpoint,
    });
  } catch (error) {
    console.error('获取 OSS 配置失败:', error);
    return NextResponse.json(
      { error: '获取配置失败', isComplete: false },
      { status: 500 }
    );
  }
}
