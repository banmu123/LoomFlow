import { supabase } from './supabase/server';

// 记录审计日志（fire-and-forget，失败不影响主流程）
export async function logAudit(options: {
  userId?: string | null;
  username?: string | null;
  action: string;
  detail?: Record<string, unknown>;
  ip?: string | null;
}): Promise<void> {
  try {
    await supabase.from('audit_logs').insert({
      user_id: options.userId || null,
      username: options.username || null,
      action: options.action,
      detail: options.detail || null,
      ip: options.ip || null,
    });
  } catch {
    // 审计失败不阻塞业务
  }
}

// 从请求头提取客户端 IP
export function getClientIp(request: Request): string | null {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return request.headers.get('x-real-ip');
}
