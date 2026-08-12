import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';
import { invalidateModelsCache } from '@/lib/ai/db-models';
import { getClientIp, logAudit } from '@/lib/audit';

const VALID_CAPABILITIES = ['text', 'vision', 'audio', 'image', 'tool'];

// 编辑模型（仅 admin）
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
    updates.provider = body.provider.trim();
  }
  if (Array.isArray(body.capabilities)) {
    const caps = body.capabilities.filter((c: string) => VALID_CAPABILITIES.includes(c));
    if (caps.length > 0) updates.capabilities = caps;
  }
  if (typeof body.label === 'string') {
    updates.label = body.label.trim() || null;
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: '没有可更新的字段' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('ai_models')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  invalidateModelsCache();
  await logAudit({
    userId: user.id,
    username: user.username,
    action: 'model_update',
    detail: { modelId: id, updates: Object.keys(updates) },
    ip: getClientIp(request),
  });

  return Response.json(data);
}

// 删除模型（仅 admin）
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

  const { error } = await supabase.from('ai_models').delete().eq('id', id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  invalidateModelsCache();
  await logAudit({
    userId: user.id,
    username: user.username,
    action: 'model_delete',
    detail: { modelId: id },
    ip: getClientIp(request),
  });

  return Response.json({ success: true });
}
