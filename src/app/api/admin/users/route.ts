import { NextRequest } from 'next/server';
import { hash } from 'bcryptjs';
import { supabase } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/server-auth';
import { validatePassword } from '@/lib/password';
import { logAudit, getClientIp } from '@/lib/audit';

// 用户列表（仅 admin）
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const { data, error } = await supabase
    .from('users')
    .select(
      'id, username, display_name, role, chat_quota, chat_used, status, failed_attempts, locked_until, created_at',
    )
    .order('created_at', { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data);
}

// 创建用户（仅 admin）
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const body = await request.json().catch(() => null);
  const username = (body?.username || '').trim();
  const password = (body?.password || '') as string;

  if (!username || !password) {
    return Response.json({ error: '用户名和密码不能为空' }, { status: 400 });
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    return Response.json({ error: passwordError }, { status: 400 });
  }

  const chatQuota =
    typeof body?.chat_quota === 'number' ? Math.max(-1, Math.floor(body.chat_quota)) : 10;

  const passwordHash = await hash(password, 10);

  const { data, error } = await supabase
    .from('users')
    .insert({
      username,
      password_hash: passwordHash,
      display_name: body?.display_name?.trim() || username,
      role: body?.role === 'admin' ? 'admin' : 'user',
      chat_quota: chatQuota,
      chat_used: 0,
      status: 'active',
    })
    .select('id, username, display_name, role, chat_quota, chat_used, status, created_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return Response.json({ error: '用户名已存在' }, { status: 409 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  await logAudit({
    userId: auth.user.id,
    username: auth.user.username,
    action: 'user_create',
    detail: { targetUser: username, role: data.role, chatQuota },
    ip: getClientIp(request),
  });

  return Response.json(data, { status: 201 });
}
