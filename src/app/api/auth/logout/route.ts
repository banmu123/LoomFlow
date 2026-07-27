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
  res.headers.append('Set-Cookie', clearAuthCookie());
  return res;
}
