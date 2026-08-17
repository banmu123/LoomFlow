import { clearAuthCookie } from '@/lib/auth';
import { logAudit, getClientIp } from '@/lib/audit';
import { getCurrentUser } from '@/lib/server-auth';

export async function POST(request: Request) {
  const user = await getCurrentUser();
  await logAudit({
    userId: user?.id,
    username: user?.username,
    action: 'logout',
    detail: {},
    ip: getClientIp(request),
  });

  const res = Response.json({ success: true });
  // 发送多个清除变体（覆盖历史 cookie 的不同 Secure 属性）
  for (const cookie of clearAuthCookie(request)) {
    res.headers.append('Set-Cookie', cookie);
  }
  return res;
}
