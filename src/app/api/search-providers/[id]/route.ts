import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';
import { invalidateSearchProvidersCache } from '@/lib/search/db-providers';
import { isBuiltinSearchProviderType } from '@/lib/search/providers';
import { encryptSecret } from '@/lib/secrets';
import { getClientIp, logAudit } from '@/lib/audit';

const VALID_CAPABILITIES = ['web', 'news', 'image', 'video'];

// 编辑搜索服务（仅 admin）
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return Response.json({ error: '无权限，仅管理员可操作' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);

  const updates: Record<string, unknown> = {};
  if (typeof body.provider === 'string' && body.provider.trim()) {
    if (!isBuiltinSearchProviderType(body.provider.trim())) {
      return Response.json({ error: 'provider 类型不合法' }, { status: 400 });
    }
    updates.provider = body.provider.trim();
  }
  if (typeof body.label === 'string') {
    updates.label = body.label.trim() || null;
  }
  if (typeof body.base_url === 'string') {
    updates.base_url = body.base_url.trim() || null;
  }
  // config 整体替换（google 的 cx 修改走这里）
  if (body.config && typeof body.config === 'object') {
    updates.config = body.config;
    if (updates.provider === 'google' && !String(body.config.cx ?? '').trim()) {
      return Response.json({ error: 'Google Custom Search 需要配置 cx（搜索引擎 ID）' }, { status: 400 });
    }
  }
  if (Array.isArray(body.capabilities)) {
    const caps = body.capabilities.filter((c: string) => VALID_CAPABILITIES.includes(c));
    if (caps.length > 0) updates.capabilities = caps;
  }
  if (typeof body.enabled === 'boolean') {
    updates.enabled = body.enabled;
  }
  // api_key 留空表示不修改；非空则更新（入库前加密）
  if (typeof body.api_key === 'string' && body.api_key.trim()) {
    updates.api_key = encryptSecret(body.api_key.trim());
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: '没有可更新的字段' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('search_providers')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  invalidateSearchProvidersCache();
  await logAudit({
    userId: user.id,
    username: user.username,
    action: 'search_provider_update',
    detail: { id, updates: Object.keys(updates), hasKey: typeof updates.api_key === 'string' },
    ip: getClientIp(request),
  });

  return Response.json(data);
}

// 删除搜索服务（仅 admin）
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return Response.json({ error: '无权限，仅管理员可操作' }, { status: 403 });
  }

  const { id } = await params;

  const { error } = await supabase.from('search_providers').delete().eq('id', id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  invalidateSearchProvidersCache();
  await logAudit({
    userId: user.id,
    username: user.username,
    action: 'search_provider_delete',
    detail: { id },
    ip: getClientIp(request),
  });

  return Response.json({ success: true });
}
