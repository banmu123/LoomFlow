import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';
import { uploadTextToOSS } from '@/lib/oss-server';
import { logAudit, getClientIp } from '@/lib/audit';

// 文档列表（当前用户的知识库）
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const { id } = await params;

  const { data: kb } = await supabase
    .from('knowledge_bases')
    .select('id, user_id')
    .eq('id', id)
    .single();
  if (!kb || kb.user_id !== user.id) {
    return Response.json({ error: '知识库不存在或无权访问' }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('knowledge_documents')
    .select('id, title, content, oss_key, file_type, file_size, created_at')
    .eq('knowledge_base_id', id)
    .order('created_at', { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json(data);
}

// 上传文档：content 始终入库（检索用）；oss 模式额外把原文存 OSS
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const { id } = await params;

  const { data: kb } = await supabase
    .from('knowledge_bases')
    .select('id, user_id, storage_type')
    .eq('id', id)
    .single();
  if (!kb || kb.user_id !== user.id) {
    return Response.json({ error: '知识库不存在或无权访问' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const title = (body?.title || '').trim();
  const content = (body?.content || '').trim();
  if (!title || !content) {
    return Response.json({ error: '标题和内容不能为空' }, { status: 400 });
  }
  if (content.length > 500_000) {
    return Response.json({ error: '文档内容过长（上限 500KB）' }, { status: 400 });
  }

  let ossKey: string | null = null;
  if (kb.storage_type === 'oss') {
    const ext = body?.file_type === 'md' ? 'md' : 'txt';
    ossKey = await uploadTextToOSS(
      `knowledge/${kb.id}/${randomUUID()}.${ext}`,
      content,
    );
    if (!ossKey) {
      return Response.json(
        { error: 'OSS 存储未配置（OSS_ACCESS_KEY_ID 等环境变量），请改用数据库存储或先配置 OSS' },
        { status: 400 },
      );
    }
  }

  const { data, error } = await supabase
    .from('knowledge_documents')
    .insert({
      knowledge_base_id: id,
      title,
      content,
      oss_key: ossKey,
      file_type: body?.file_type === 'md' ? 'md' : body?.file_type === 'paste' ? 'paste' : 'txt',
      file_size: content.length,
    })
    .select('id, title, content, oss_key, file_type, file_size, created_at')
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  await logAudit({
    userId: user.id,
    username: user.username,
    action: 'knowledge_document_add',
    detail: { kbId: id, docId: data.id, title, storage: kb.storage_type },
    ip: getClientIp(request),
  });

  return Response.json(data, { status: 201 });
}
