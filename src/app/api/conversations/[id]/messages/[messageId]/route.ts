import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';

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

// 更新单条消息（流式生成中/完成后更新内容与状态；消息 id 为 UUID 即已入库）
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const { id, messageId } = await params;
  const denied = await checkConversationAccess(id, user);
  if (denied) return denied;

  const body = await request.json().catch(() => null);

  // 只允许更新内容相关字段（role 不可改）
  const patch: Record<string, unknown> = {};
  if (body?.content !== undefined) patch.content = body.content;
  if (body?.status !== undefined) patch.status = body.status;
  if (body?.reasoning !== undefined) patch.reasoning = body.reasoning;
  if (body?.error !== undefined) patch.error = body.error;
  if (body?.tool_logs !== undefined) patch.tool_logs = body.tool_logs;

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: '没有可更新的字段' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('messages')
    .update(patch)
    .eq('id', messageId)
    .eq('conversation_id', id)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data);
}

// 删除单条消息（重新生成时移除旧回复）
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const { id, messageId } = await params;
  const denied = await checkConversationAccess(id, user);
  if (denied) return denied;

  const { error } = await supabase
    .from('messages')
    .delete()
    .eq('id', messageId)
    .eq('conversation_id', id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
