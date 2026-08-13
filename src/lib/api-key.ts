import { randomBytes } from 'crypto';
import { supabase } from './supabase/server';

export interface UserApiKey {
  user_id: string;
  api_key: string;
  api_key_expires_days: number | null;
  api_key_expires_at: string | null;
  created_at: string;
}

// 读取用户全局 API Key（无则返回 null）
export async function getUserApiKey(userId: string): Promise<UserApiKey | null> {
  const { data } = await supabase
    .from('user_api_keys')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  return (data as UserApiKey | null) ?? null;
}

// 确保用户有全局 API Key；没有则自动生成（有效期配置仅首次生效）
// 返回 { created, api_key }——api_key 仅 created 时返回（只显示一次）
export async function ensureUserApiKey(
  userId: string,
  config: { expires_days?: number } = {},
): Promise<{ created: boolean; api_key?: string }> {
  const existing = await getUserApiKey(userId);
  if (existing) return { created: false };

  const days =
    typeof config.expires_days === 'number' && config.expires_days > 0
      ? Math.floor(config.expires_days)
      : 0;

  const apiKey = `ffk_${randomBytes(24).toString('hex')}`;

  const { error } = await supabase.from('user_api_keys').insert({
    user_id: userId,
    api_key: apiKey,
    api_key_expires_days: days > 0 ? days : null,
    api_key_expires_at:
      days > 0 ? new Date(Date.now() + days * 24 * 3600 * 1000).toISOString() : null,
  });

  if (error) throw new Error(error.message);
  return { created: true, api_key: apiKey };
}

// 轮换全局 API Key：旧 Key 立即失效，有效期配置保留
// 返回新 Key（仅本次返回，只显示一次）
export async function rotateUserApiKey(
  userId: string,
): Promise<{ api_key: string; api_key_expires_at: string | null }> {
  const existing = await getUserApiKey(userId);
  if (!existing) throw new Error('尚未生成 API Key');

  const newKey = `ffk_${randomBytes(24).toString('hex')}`;
  // 有效期按配置天数从当前重新计算（已过期的 Key 轮换后获得新的有效窗口）
  const days = existing.api_key_expires_days && existing.api_key_expires_days > 0
    ? existing.api_key_expires_days
    : 0;

  const { data, error } = await supabase
    .from('user_api_keys')
    .update({
      api_key: newKey,
      api_key_expires_at:
        days > 0 ? new Date(Date.now() + days * 24 * 3600 * 1000).toISOString() : null,
    })
    .eq('user_id', userId)
    .select('api_key_expires_at')
    .single();

  if (error) throw new Error(error.message);
  return { api_key: newKey, ...data };
}
