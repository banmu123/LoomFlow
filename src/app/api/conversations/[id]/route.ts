import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';
import { logAudit, getClientIp } from '@/lib/audit';

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

export async function PATCH(
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
  const title = body?.title?.trim();

  if (!title) {
    return Response.json({ error: 'title 不能为空' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('conversations')
    .update({ title })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data);
}

export async function DELETE(
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

  const { data: conv } = await supabase
    .from('conversations')
    .select('title')
    .eq('id', id)
    .single();

  const { error } = await supabase
    .from('conversations')
    .delete()
    .eq('id', id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  await logAudit({
    userId: user.id,
    username: user.username,
    action: 'conversation_delete',
    detail: { conversationId: id, title: conv?.title },
    ip: getClientIp(request),
  });

  return Response.json({ success: true });
}
