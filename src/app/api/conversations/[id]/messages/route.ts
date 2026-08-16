import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';
import { ensureGeneration } from '@/lib/agent/generate';

// 校验对话归属：完全隔离，仅本人可操作
async function checkConversationAccess(
  id: string,
  user: { id: string; role: string },
): Promise<Response | null> {
  const { data: conv, error } = await supabase
    .from('conversations')
    .select('user_id')
    .eq('id', id)
    .single();

  if (error || !conv) {
    return Response.json({ error: '对话不存在' }, { status: 404 });
  }
  if (conv.user_id !== user.id) {
    return Response.json({ error: '无权操作该对话' }, { status: 403 });
  }
  return null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const { id } = await params;
  const denied = await checkConversationAccess(id, user);
  if (denied) return denied;

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // 兜底触发：发现未完成的 assistant 消息（pending/streaming）且无执行者时，
  // 启动后台生成（幂等，防重复）。保证 route 的 fire-and-forget 失效时生成仍会执行。
  const unfinished = (data ?? []).filter(
    (m: { role?: string; status?: string }) =>
      m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming'),
  );
  for (const m of unfinished as Array<{ id: string }>) {
    ensureGeneration({ conversationId: id, assistantMessageId: m.id });
  }

  return Response.json(data);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const { id } = await params;
  const denied = await checkConversationAccess(id, user);
  if (denied) return denied;

  const body = await request.json().catch(() => null);

  if (!body?.role || body?.content === undefined) {
    return Response.json({ error: 'role 和 content 不能为空' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: id,
      user_id: user.id,
      role: body.role,
      content: body.content,
      reasoning: body.reasoning || null,
      status: body.status || 'done',
      error: body.error || null,
      images: Array.isArray(body.images) ? body.images : null,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // 同时更新 conversation 的 updated_at
  await supabase
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', id);

  return Response.json(data, { status: 201 });
}
