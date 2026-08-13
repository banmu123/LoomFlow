import { cookies } from 'next/headers';
import { verifyJWT, COOKIE_NAME } from './auth';
import { supabase } from './supabase/server';

export interface AuthUser {
  id: string;
  username: string;
  display_name: string | null;
  role: string;
  status: string;
}

// 从 cookie 获取当前登录用户（未登录/无效 token 返回 null）
export async function getCurrentUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = verifyJWT(token);
  if (!payload) return null;

  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('id', payload.uid)
    .single();

  return (data as AuthUser) || null;
}

// 要求管理员权限，返回用户信息或 401/403 Response
export async function requireAdmin(): Promise<
  | { user: AuthUser }
  | Response
> {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return Response.json({ error: '无权限，仅管理员可操作' }, { status: 403 });
  }
  return { user };
}
