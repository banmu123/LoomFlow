import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { createSearchProvider } from '@/lib/search/providers';
import { getSearchProviderById } from '@/lib/search/db-providers';
import { isBuiltinSearchProviderType } from '@/lib/search/providers';
import { getClientIp, logAudit } from '@/lib/audit';
import type { SearchProviderDefinition } from '@/lib/search';

// 测试连接（仅 admin）
// body 支持两种：
//   { id: "xxx" }                    → 用已保存配置测试（apiKey 从 DB 读取）
//   { provider, apiKey, baseURL, config, label } → 用表单当前值测试（新建时）
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return Response.json({ error: '无权限，仅管理员可操作' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return Response.json({ error: '请求体无效' }, { status: 400 });
  }

  let def: SearchProviderDefinition;

  if (typeof body.id === 'string' && body.id.trim()) {
    // 已保存配置：读取 DB（含 apiKey）
    const saved = await getSearchProviderById(body.id.trim());
    if (!saved) {
      return Response.json({ error: '搜索服务不存在或已删除' }, { status: 404 });
    }
    def = saved;
  } else {
    // 表单当前值
    const provider = (body.provider || '').trim();
    if (!isBuiltinSearchProviderType(provider)) {
      return Response.json({ error: 'provider 类型不合法' }, { status: 400 });
    }
    const apiKey = (body.apiKey || '').trim();
    if (!apiKey) {
      return Response.json({ error: 'API Key 不能为空' }, { status: 400 });
    }
    const config = body.config && typeof body.config === 'object' ? body.config : {};
    if (provider === 'google' && !String(config.cx ?? '').trim()) {
      return Response.json({ error: 'Google Custom Search 需要配置 cx（搜索引擎 ID）' }, { status: 400 });
    }
    def = {
      id: 'test',
      provider,
      apiKey,
      baseURL: body.baseURL?.trim() || undefined,
      config,
      enabled: true,
      capabilities: ['web'],
    };
  }

  const provider = createSearchProvider(def);
  const result = provider.testConnection
    ? await provider.testConnection()
    : { ok: true, message: '该 provider 不支持测试连接' };

  await logAudit({
    userId: user.id,
    username: user.username,
    action: 'search_provider_test',
    detail: { id: body.id || 'new', provider: def.provider, ok: result.ok },
    ip: getClientIp(request),
  });

  return Response.json(result, { status: result.ok ? 200 : 502 });
}
