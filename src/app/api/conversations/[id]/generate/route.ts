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

// 发送消息并触发后台生成：
// 1. 插入 user 消息（done）+ assistant 消息（pending）到数据库
// 2. 后台异步执行 AI 生成（不阻塞响应；生成状态以数据库为准，前端轮询观察）
// 3. regenerate=true 时只插入 assistant 消息（用户消息已在历史中）
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  if (user.status !== 'active') {
    return Response.json({ error: '账号已被禁用，请联系管理员' }, { status: 403 });
  }

  const { id } = await params;
  const denied = await checkConversationAccess(id, user);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const content = typeof body?.content === 'string' ? body.content.trim() : '';
  if (!content) {
    return Response.json({ error: '消息内容不能为空' }, { status: 400 });
  }

  const images = Array.isArray(body?.images) ? body.images.filter((u: unknown) => typeof u === 'string') : [];
  const model = typeof body?.model === 'string' ? body.model : undefined;
  const regenerate = body?.regenerate === true;

  // 插入 user 消息（regenerate 时历史已存在，不重复插入）
  let userMsg = null;
  if (!regenerate) {
    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: id,
        user_id: user.id,
        role: 'user',
        content,
        status: 'done',
        images: images.length > 0 ? images : null,
      })
      .select()
      .single();
    if (error || !data) {
      return Response.json({ error: error?.message || '保存消息失败' }, { status: 500 });
    }
    userMsg = data;
  }

  // 插入 assistant 消息（pending：生成开始）
  const { data: assistantMsg, error: asstError } = await supabase
    .from('messages')
    .insert({
      conversation_id: id,
      user_id: user.id,
      role: 'assistant',
      content: '',
      status: 'pending',
    })
    .select()
    .single();
  if (asstError || !assistantMsg) {
    return Response.json({ error: asstError?.message || '创建生成任务失败' }, { status: 500 });
  }

  // 更新对话的 updated_at
  await supabase
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', id);

  // 触发后台生成（幂等；若此处的 fire-and-forget 未执行，轮询端点会兜底触发）
  ensureGeneration({
    conversationId: id,
    assistantMessageId: assistantMsg.id,
    model,
    images,
  });

  return Response.json({ userMessage: userMsg, assistantMessage: assistantMsg }, { status: 201 });
}
