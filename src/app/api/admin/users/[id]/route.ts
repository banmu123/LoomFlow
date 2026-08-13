import { NextRequest } from 'next/server';
import { hash } from 'bcryptjs';
import { supabase } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/server-auth';
import { validatePassword } from '@/lib/password';
import { logAudit, getClientIp } from '@/lib/audit';

// 更新用户（仅 admin）
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) {
    return Response.json({ error: '请求体为空' }, { status: 400 });
  }

  // 组装可更新字段
  const updates: Record<string, unknown> = {};
  const changed: string[] = [];

  if (typeof body.display_name === 'string' && body.display_name.trim()) {
    updates.display_name = body.display_name.trim();
    changed.push('display_name');
  }
  if (body.role === 'admin' || body.role === 'user') {
    updates.role = body.role;
    changed.push('role');
  }
  if (typeof body.status === 'string' && ['active', 'disabled'].includes(body.status)) {
    updates.status = body.status;
    changed.push('status');
  }
  if (typeof body.password === 'string' && body.password) {
    const passwordError = validatePassword(body.password);
    if (passwordError) {
      return Response.json({ error: passwordError }, { status: 400 });
    }
    updates.password_hash = await hash(body.password, 10);
    changed.push('password');
  }
  // 解锁：重置失败计数和锁定时间
  if (body.unlock === true) {
    updates.failed_attempts = 0;
    updates.locked_until = null;
    changed.push('unlock');
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: '没有可更新的字段' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', id)
    .select(
      'id, username, display_name, role, status, failed_attempts, locked_until, created_at',
    )
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  await logAudit({
    userId: auth.user.id,
    username: auth.user.username,
    action: 'user_update',
    detail: { targetUser: data.username, changed },
    ip: getClientIp(request),
  });

  return Response.json(data);
}

// 删除用户（仅 admin，不能删自己）
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const { id } = await params;
  if (id === auth.user.id) {
    return Response.json({ error: '不能删除当前登录的账号' }, { status: 400 });
  }

  const { data: target } = await supabase
    .from('users')
    .select('username')
    .eq('id', id)
    .single();

  const { error } = await supabase.from('users').delete().eq('id', id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  await logAudit({
    userId: auth.user.id,
    username: auth.user.username,
    action: 'user_delete',
    detail: { targetUser: target?.username },
    ip: getClientIp(request),
  });

  return Response.json({ success: true });
}
