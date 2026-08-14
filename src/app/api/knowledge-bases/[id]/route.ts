import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';

// 校验知识库归属：返回知识库或错误 Response
async function getOwnedKb(id: string, userId: string) {
  const { data } = await supabase
    .from('knowledge_bases')
    .select('id, user_id')
    .eq('id', id)
    .single();
  if (!data) return null;
  if (data.user_id !== userId) return 'forbidden';
  return data;
}

// 更新知识库（名称/描述）
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const { id } = await params;

  const owned = await getOwnedKb(id, user.id);
  if (owned === null) {
    return Response.json({ error: '知识库不存在' }, { status: 404 });
  }
  if (owned === 'forbidden') {
    return Response.json({ error: '无权操作该知识库' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const updates: Record<string, unknown> = {};
  if (typeof body?.name === 'string' && body.name.trim()) {
    updates.name = body.name.trim();
  }
  if (typeof body?.description === 'string') {
    updates.description = body.description.trim() || null;
  }
  if (Object.keys(updates).length === 0) {
    return Response.json({ error: '没有可更新的字段' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('knowledge_bases')
    .update(updates)
    .eq('id', id)
    .select('id, name, description, storage_type, created_at, updated_at')
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json(data);
}

// 删除知识库（级联删除文档）
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const { id } = await params;

  const owned = await getOwnedKb(id, user.id);
  if (owned === null) {
    return Response.json({ error: '知识库不存在' }, { status: 404 });
  }
  if (owned === 'forbidden') {
    return Response.json({ error: '无权操作该知识库' }, { status: 403 });
  }

  const { error } = await supabase.from('knowledge_bases').delete().eq('id', id);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ success: true });
}
