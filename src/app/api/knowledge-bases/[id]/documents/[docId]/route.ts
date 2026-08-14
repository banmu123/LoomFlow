import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';

// 删除文档
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const { id, docId } = await params;

  // 校验知识库归属 + 文档属于该知识库
  const { data: kb } = await supabase
    .from('knowledge_bases')
    .select('id, user_id')
    .eq('id', id)
    .single();
  if (!kb || kb.user_id !== user.id) {
    return Response.json({ error: '知识库不存在或无权访问' }, { status: 404 });
  }

  const { data: doc } = await supabase
    .from('knowledge_documents')
    .select('id')
    .eq('id', docId)
    .eq('knowledge_base_id', id)
    .single();
  if (!doc) {
    return Response.json({ error: '文档不存在' }, { status: 404 });
  }

  const { error } = await supabase.from('knowledge_documents').delete().eq('id', docId);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ success: true });
}
