import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';
import { invalidateSearchProvidersCache } from '@/lib/search/db-providers';
import { isBuiltinSearchProviderType } from '@/lib/search/providers';
import { encryptSecret } from '@/lib/secrets';
import { getClientIp, logAudit } from '@/lib/audit';

const VALID_CAPABILITIES = ['web', 'news', 'image', 'video'];

// 搜索服务列表（登录用户可查看；不返回 api_key）
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('search_providers')
    .select('id, provider, label, base_url, config, capabilities, enabled, created_at')
    .order('id');

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data);
}

// 新增搜索服务（仅 admin）
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return Response.json({ error: '无权限，仅管理员可操作' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const id = (body?.id || '').trim();
  const provider = (body?.provider || '').trim();

  if (!id || !provider) {
    return Response.json({ error: '配置名和 provider 类型不能为空' }, { status: 400 });
  }
  if (!isBuiltinSearchProviderType(provider)) {
    return Response.json(
      { error: `provider 类型不合法，支持: ${['tavily', 'exa', 'google'].join(' / ')}` },
      { status: 400 },
    );
  }

  const apiKey = (body?.api_key || '').trim();
  if (!apiKey) {
    return Response.json({ error: 'API Key 不能为空' }, { status: 400 });
  }

  const config = body?.config && typeof body.config === 'object' ? body.config : {};
  if (provider === 'google' && !String(config.cx ?? '').trim()) {
    return Response.json({ error: 'Google Custom Search 需要配置 cx（搜索引擎 ID）' }, { status: 400 });
  }

  const capabilities = Array.isArray(body?.capabilities)
    ? body.capabilities.filter((c: string) => VALID_CAPABILITIES.includes(c))
    : ['web'];
  if (capabilities.length === 0) {
    return Response.json({ error: 'capabilities 无效' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('search_providers')
    .insert({
      id,
      provider,
      label: body?.label?.trim() || null,
      // 入库前加密（AES-256-GCM，密钥派生自 AUTH_SECRET）
      api_key: encryptSecret(apiKey),
      base_url: body?.base_url?.trim() || null,
      config,
      capabilities,
      enabled: body?.enabled !== false,
    })
    .select('id, provider, label, base_url, config, capabilities, enabled, created_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return Response.json({ error: '配置名已存在' }, { status: 409 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  invalidateSearchProvidersCache();
  await logAudit({
    userId: user.id,
    username: user.username,
    action: 'search_provider_create',
    detail: { id, provider, capabilities, enabled: data.enabled, hasKey: true },
    ip: getClientIp(request),
  });

  return Response.json(data, { status: 201 });
}
