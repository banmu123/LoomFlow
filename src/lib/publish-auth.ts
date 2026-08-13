import { supabase } from './supabase/server';
import type { TinyflowData } from './tinyflow/types';

export interface PublishedWorkflow {
  id: string;
  title: string;
  data: TinyflowData;
}

// 全局 API Key 鉴权：一个用户一个 Key，可调用该用户所有已发布工作流
// 返回 { workflow, userId }；失败返回 Response（401/403/404）
export async function getWorkflowByApiKey(
  authHeader: string | null,
  expectedId?: string,
): Promise<{ workflow: PublishedWorkflow; userId: string } | Response> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return Response.json({ error: '缺少 API Key（Authorization: Bearer <key>）' }, { status: 401 });
  }

  const apiKey = authHeader.slice(7).trim();
  if (!apiKey) {
    return Response.json({ error: '缺少 API Key' }, { status: 401 });
  }

  // 全局 Key → 找到所属用户
  const { data: keyRow } = await supabase
    .from('user_api_keys')
    .select('user_id, api_key_expires_at')
    .eq('api_key', apiKey)
    .single();

  if (!keyRow) {
    return Response.json({ error: 'API Key 无效或已重新生成' }, { status: 401 });
  }

  // Key 过期校验（未设置有效期 = 永不过期）
  if (
    keyRow.api_key_expires_at &&
    new Date(keyRow.api_key_expires_at).getTime() < Date.now()
  ) {
    return Response.json(
      { error: 'API Key 已过期，请在管理页面重新生成' },
      { status: 401 },
    );
  }

  // 目标工作流：必须已发布且属于该用户
  if (!expectedId) {
    return Response.json({ error: '缺少工作流 ID' }, { status: 400 });
  }
  const { data: wf } = await supabase
    .from('workflow_history')
    .select('id, title, data')
    .eq('id', expectedId)
    .eq('published', true)
    .eq('user_id', keyRow.user_id)
    .single();

  if (!wf) {
    return Response.json({ error: '工作流不存在、未发布或无权访问' }, { status: 404 });
  }

  return { workflow: wf as PublishedWorkflow, userId: keyRow.user_id };
}
