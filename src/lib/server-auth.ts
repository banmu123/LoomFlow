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

// 用户查询短 TTL 缓存（按 token 键）：消除每个请求/轮询的 DB 往返
// —— 这是当前所有 API 的固定延迟大头（Supabase 网络往返 100ms+）。
// 代价：封禁/删除/改角色最迟 TTL 过后生效（单实例部署，进程内缓存即可）。
// 测试不受影响：相关测试均 mock 整个 server-auth 模块，不执行此缓存路径。
const USER_CACHE_TTL_MS = 30_000;
const USER_CACHE_MAX = 500;
const userCache = new Map<string, { user: AuthUser | null; expires: number }>();

// 从 cookie 获取当前登录用户（未登录/无效 token 返回 null）
export async function getCurrentUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = verifyJWT(token);
  if (!payload) return null;

  const cached = userCache.get(token);
  if (cached && Date.now() < cached.expires) return cached.user;

  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('id', payload.uid)
    .single();

  const user = (data as AuthUser) || null;
  userCache.set(token, { user, expires: Date.now() + USER_CACHE_TTL_MS });
  // 简单防膨胀：超限全清（登录用户量级小，实际难触发）
  if (userCache.size > USER_CACHE_MAX) userCache.clear();
  return user;
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
