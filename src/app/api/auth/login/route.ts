import { NextRequest } from 'next/server';
import { compare } from 'bcryptjs';
import { supabase } from '@/lib/supabase/server';
import { signJWT, authCookie } from '@/lib/auth';
import { logAudit, getClientIp } from '@/lib/audit';

const MAX_FAILED_ATTEMPTS = 5; // 连续失败 5 次锁定
const LOCK_DURATION_MS = 15 * 60 * 1000; // 锁 15 分钟

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const body = await request.json().catch(() => null);
  const username = (body?.username || '').trim();
  const password = (body?.password || '') as string;

  if (!username || !password) {
    return Response.json({ error: '用户名和密码不能为空' }, { status: 400 });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('username', username)
    .single();

  if (error || !user) {
    // 用户不存在：仍走审计（记录尝试），返回统一错误防用户名枚举
    await logAudit({
      username,
      action: 'login_failed',
      detail: { reason: 'user_not_found' },
      ip,
    });
    return Response.json({ error: '用户名或密码错误' }, { status: 401 });
  }

  // 检查是否处于锁定期
  const lockedUntil = user.locked_until ? new Date(user.locked_until).getTime() : 0;
  if (lockedUntil > Date.now()) {
    const minutesLeft = Math.ceil((lockedUntil - Date.now()) / 60000);
    await logAudit({
      userId: user.id,
      username: user.username,
      action: 'login_locked',
      detail: { minutesLeft },
      ip,
    });
    return Response.json(
      { error: `登录失败次数过多，账号已锁定，请 ${minutesLeft} 分钟后再试` },
      { status: 423 },
    );
  }

  const passwordOk = await compare(password, user.password_hash);

  if (!passwordOk) {
    // 密码错误：累计失败次数，达到阈值锁定
    const failed = (user.failed_attempts || 0) + 1;
    const willLock = failed >= MAX_FAILED_ATTEMPTS;

    await supabase
      .from('users')
      .update({
        failed_attempts: willLock ? 0 : failed,
        locked_until: willLock
          ? new Date(Date.now() + LOCK_DURATION_MS).toISOString()
          : null,
      })
      .eq('id', user.id);

    await logAudit({
      userId: user.id,
      username: user.username,
      action: 'login_failed',
      detail: { attempt: failed, maxAttempts: MAX_FAILED_ATTEMPTS },
      ip,
    });

    const msg = willLock
      ? `密码错误次数过多，账号已锁定 ${LOCK_DURATION_MS / 60000} 分钟`
      : `用户名或密码错误（还可尝试 ${MAX_FAILED_ATTEMPTS - failed} 次）`;
    return Response.json({ error: msg }, { status: 401 });
  }

  // 登录成功：重置失败计数 + 审计
  if (user.failed_attempts > 0 || user.locked_until) {
    await supabase
      .from('users')
      .update({ failed_attempts: 0, locked_until: null })
      .eq('id', user.id);
  }

  await logAudit({
    userId: user.id,
    username: user.username,
    action: 'login_success',
    ip,
  });

  let token: string;
  try {
    token = signJWT({
      uid: user.id,
      username: user.username,
      role: user.role,
    });
  } catch (err) {
    // AUTH_SECRET 未配置：拒绝签发，明确提示服务端配置问题
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

  const res = Response.json({
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
    },
  });

  res.headers.append('Set-Cookie', authCookie(token));
  return res;
}
