import { supabase } from './supabase/server';
import type { TinyflowData } from './tinyflow/types';

export interface PublishedWorkflow {
  id: string;
  title: string;
  data: TinyflowData;
}

// 从 Authorization: Bearer <key> 解析并校验 API Key，返回对应工作流
export async function getWorkflowByApiKey(
  authHeader: string | null,
  expectedId?: string,
): Promise<{ workflow: PublishedWorkflow } | Response> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return Response.json({ error: '缺少 API Key（Authorization: Bearer <key>）' }, { status: 401 });
  }

  const apiKey = authHeader.slice(7).trim();
  if (!apiKey) {
    return Response.json({ error: '缺少 API Key' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('workflow_history')
    .select('id, title, data')
    .eq('published', true)
    .eq('api_key', apiKey)
    .single();

  if (error || !data) {
    return Response.json({ error: 'API Key 无效或工作流已取消发布' }, { status: 401 });
  }

  // 如果请求了特定工作流 id，校验 key 属于它
  if (expectedId && data.id !== expectedId) {
    return Response.json({ error: 'API Key 与该工作流不匹配' }, { status: 403 });
  }

  return { workflow: data as PublishedWorkflow };
}
