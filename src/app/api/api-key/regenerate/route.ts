import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { logAudit, getClientIp } from '@/lib/audit';
import { rotateUserApiKey } from '@/lib/api-key';

// 重新生成全局 API Key：旧 Key 立即失效，有效期配置保留
// 新 Key 只在本次响应返回一次（仅显示一次）
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  let data: Awaited<ReturnType<typeof rotateUserApiKey>>;
  try {
    data = await rotateUserApiKey(user.id);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 404 });
  }

  await logAudit({
    userId: user.id,
    username: user.username,
    action: 'api_key_regenerate',
    detail: {},
    ip: getClientIp(request),
  });

  return Response.json(data);
}
