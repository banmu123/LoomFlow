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

// 用户主动停止生成：把消息状态置为 cancelled。
// 后台生成任务在写库前检查状态，发现 cancelled 即停止并保存已生成内容。
export async function POST(
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

  const { data: msg } = await supabase
    .from('messages')
    .select('id, status')
    .eq('id', messageId)
    .eq('conversation_id', id)
    .single();

  if (!msg) {
    return Response.json({ error: '消息不存在' }, { status: 404 });
  }

  // 仅生成中的消息可取消（已完成/已取消/出错的消息忽略）
  if (msg.status === 'pending' || msg.status === 'streaming') {
    await supabase.from('messages').update({ status: 'cancelled' }).eq('id', messageId);
  }

  return Response.json({ success: true });
}
