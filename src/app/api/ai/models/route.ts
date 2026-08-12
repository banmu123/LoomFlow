import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';
import { invalidateModelsCache } from '@/lib/ai/db-models';
import { getClientIp, logAudit } from '@/lib/audit';

const VALID_CAPABILITIES = ['text', 'vision', 'audio', 'image', 'tool'];

// 模型列表（登录用户可查看）
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  // 不返回 api_key（避免泄露）
  const { data, error } = await supabase
    .from('ai_models')
    .select('id, provider, capabilities, label, base_url, created_at')
    .order('id');

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data);
}

// 新增模型（仅 admin）
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
    return Response.json({ error: '模型 ID 和 provider 不能为空' }, { status: 400 });
  }
  const capabilities = Array.isArray(body?.capabilities)
    ? body.capabilities.filter((c: string) => VALID_CAPABILITIES.includes(c))
    : ['text'];
  if (capabilities.length === 0) {
    return Response.json({ error: 'capabilities 无效' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('ai_models')
    .insert({
      id,
      provider,
      capabilities,
      label: body?.label?.trim() || null,
      base_url: body?.base_url?.trim() || null,
      api_key: body?.api_key?.trim() || null,
    })
    .select('id, provider, capabilities, label, base_url, created_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return Response.json({ error: '模型 ID 已存在' }, { status: 409 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  invalidateModelsCache();
  await logAudit({
    userId: user.id,
    username: user.username,
    action: 'model_create',
    detail: { modelId: id, provider, capabilities, hasKey: !!body?.api_key },
    ip: getClientIp(request),
  });

  return Response.json(data, { status: 201 });
}
