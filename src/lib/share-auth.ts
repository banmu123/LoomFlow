import { supabase } from './supabase/server';
import type { TinyflowData } from './tinyflow/types';

export interface SharedWorkflow {
  id: string;
  title: string;
  data: TinyflowData;
  share_token: string;
}

// 通过分享 token 获取工作流（无需登录）
export async function getWorkflowByShareToken(
  token: string,
): Promise<{ workflow: SharedWorkflow } | Response> {
  if (!token) {
    return Response.json({ error: '缺少分享标识' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('workflow_history')
    .select('id, title, data, share_token')
    .eq('share_token', token)
    .single();

  if (error || !data) {
    return Response.json({ error: '分享链接无效或已失效' }, { status: 404 });
  }

  return { workflow: data as SharedWorkflow };
}
