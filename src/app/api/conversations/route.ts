import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  // 完全隔离：所有用户（含 admin）只能看到自己的对话
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data);
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const title = body?.title?.trim() || '新建对话';
  // 记录创建时的模型选择（ChatLanding 传入），对话页加载时恢复
  const model = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : null;

  const { data, error } = await supabase
    .from('conversations')
    .insert({ title, user_id: user.id, model })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // 可选：创建时携带首条用户消息（新聊天欢迎页跳转优化——减少一个串行请求）
  // 内容来自欢迎页输入框/推荐模板，status=done（对话页检测到 user done 后自动触发生成）
  const firstContent = body?.content?.trim();
  if (firstContent && data?.id) {
    await supabase
      .from('messages')
      .insert({
        conversation_id: data.id,
        role: 'user',
        content: firstContent,
        status: 'done',
      })
      .then(() => undefined)
      .catch(() => {
        // 首条消息写入失败不阻断对话创建（对话页会自动补发）
      });
  }

  return Response.json(data, { status: 201 });
}
