import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';
import { logAudit, getClientIp } from '@/lib/audit';
import { ensureUserApiKey } from '@/lib/api-key';

// 当前用户的全局 API Key 状态（不返回 Key 明文，安全）
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const { data } = await supabase
    .from('user_api_keys')
    .select('api_key_expires_days, api_key_expires_at, created_at')
    .eq('user_id', user.id)
    .maybeSingle();

  return Response.json(data ?? null);
}

// 手动生成全局 API Key（仅当尚未生成时；Key 只在本次响应返回一次）
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const { created, api_key } = await ensureUserApiKey(user.id, {
    expires_days: typeof body?.expires_days === 'number' ? body.expires_days : undefined,
  });

  if (!created) {
    return Response.json({ error: 'API Key 已存在，可前往管理页重新生成' }, { status: 409 });
  }

  await logAudit({
    userId: user.id,
    username: user.username,
    action: 'api_key_generate',
    detail: {},
    ip: getClientIp(request),
  });

  return Response.json({ api_key });
}

// 修改全局 API Key 有效期
// body：{ expires_days?: 0 永不过期 | N 天 }
export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (typeof body?.expires_days !== 'number') {
    return Response.json({ error: 'expires_days 必填' }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from('user_api_keys')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!existing) {
    return Response.json({ error: '尚未生成 API Key' }, { status: 404 });
  }

  // 0 = 永不过期；N = N 天后过期
  const days = Math.max(0, Math.floor(body.expires_days));

  const { data, error } = await supabase
    .from('user_api_keys')
    .update({
      api_key_expires_days: days > 0 ? days : null,
      api_key_expires_at:
        days > 0 ? new Date(Date.now() + days * 24 * 3600 * 1000).toISOString() : null,
    })
    .eq('user_id', user.id)
    .select('api_key_expires_days, api_key_expires_at')
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  await logAudit({
    userId: user.id,
    username: user.username,
    action: 'api_key_config',
    detail: { expires_days: days },
    ip: getClientIp(request),
  });

  return Response.json(data);
}
