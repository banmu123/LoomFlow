import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';
import { logAudit, getClientIp } from '@/lib/audit';

// 知识库列表（当前用户）
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('knowledge_bases')
    .select('id, name, description, storage_type, created_at, updated_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data);
}

// 创建知识库（storage_type：database 存数据库 / oss 存 OSS，均保留检索文本）
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const name = (body?.name || '').trim();
  if (!name) {
    return Response.json({ error: '知识库名称不能为空' }, { status: 400 });
  }
  const storageType = body?.storage_type === 'oss' ? 'oss' : 'database';

  const { data, error } = await supabase
    .from('knowledge_bases')
    .insert({
      user_id: user.id,
      name,
      description: body?.description?.trim() || null,
      storage_type: storageType,
    })
    .select('id, name, description, storage_type, created_at, updated_at')
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  await logAudit({
    userId: user.id,
    username: user.username,
    action: 'knowledge_base_create',
    detail: { kbId: data.id, name, storageType },
    ip: getClientIp(request),
  });

  return Response.json(data, { status: 201 });
}
