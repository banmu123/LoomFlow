import { NextRequest } from 'next/server';
import { compare, hash } from 'bcryptjs';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';
import { validatePassword } from '@/lib/password';
import { logAudit, getClientIp } from '@/lib/audit';
import { clearAuthCookie } from '@/lib/auth';

// 用户自助修改密码（需登录 + 验证旧密码）
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const oldPassword = (body?.old_password || '') as string;
  const newPassword = (body?.new_password || '') as string;

  if (!oldPassword || !newPassword) {
    return Response.json({ error: '旧密码和新密码不能为空' }, { status: 400 });
  }
  const passwordError = validatePassword(newPassword);
  if (passwordError) {
    return Response.json({ error: passwordError }, { status: 400 });
  }
  if (oldPassword === newPassword) {
    return Response.json({ error: '新密码不能与旧密码相同' }, { status: 400 });
  }

  // 验证旧密码
  const { data: dbUser } = await supabase
    .from('users')
    .select('password_hash')
    .eq('id', user.id)
    .single();

  if (!dbUser) {
    return Response.json({ error: '用户不存在' }, { status: 404 });
  }

  const passwordOk = await compare(oldPassword, dbUser.password_hash);
  if (!passwordOk) {
    await logAudit({
      userId: user.id,
      username: user.username,
      action: 'password_change_failed',
      detail: { reason: 'old_password_wrong' },
      ip: getClientIp(request),
    });
    return Response.json({ error: '旧密码不正确' }, { status: 400 });
  }

  const newHash = await hash(newPassword, 10);
  const { error } = await supabase
    .from('users')
    .update({ password_hash: newHash })
    .eq('id', user.id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  await logAudit({
    userId: user.id,
    username: user.username,
    action: 'password_change',
    detail: {},
    ip: getClientIp(request),
  });

  // 改密码后清除登录态，强制重新登录（多个变体覆盖历史 cookie）
  const res = Response.json({ success: true });
  for (const cookie of clearAuthCookie()) {
    res.headers.append('Set-Cookie', cookie);
  }
  return res;
}
