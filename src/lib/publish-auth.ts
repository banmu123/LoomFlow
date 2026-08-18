import { supabase } from './supabase/server';
import { hashApiKey } from './api-key';
import { decryptSecret } from './secrets';
import type { TinyflowData } from './tinyflow/types';

interface ApiKeyRow {
  user_id: string;
  api_key_expires_at: string | null;
  api_key: string | null;
}

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
  // api_key 列存密文，无法等值查询：先按哈希列查，命中后解密二次校验；
  // 哈希未命中时回退按明文查（存量历史 key 兼容，下次轮换后自动迁移为密文）
  const keyHash = hashApiKey(apiKey);
  let keyRow: ApiKeyRow | null = null;
  const { data: hashHit } = (await supabase
    .from('user_api_keys')
    .select('user_id, api_key_expires_at, api_key')
    .eq('api_key_hash', keyHash)
    .maybeSingle()) as { data: ApiKeyRow | null };
  if (hashHit) {
    keyRow = hashHit;
    // 密文二次校验（防哈希碰撞 / 数据损坏）
    if (decryptSecret(String(keyRow.api_key ?? '')) !== apiKey) {
      keyRow = null;
    }
  } else {
    const { data: legacy } = (await supabase
      .from('user_api_keys')
      .select('user_id, api_key_expires_at, api_key')
      .eq('api_key', apiKey)
      .maybeSingle()) as { data: ApiKeyRow | null };
    keyRow = legacy;
  }

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
    .select('id, title, data, published_data')
    .eq('id', expectedId)
    .eq('published', true)
    .eq('user_id', keyRow.user_id)
    .single();

  if (!wf) {
    return Response.json({ error: '工作流不存在、未发布或无权访问' }, { status: 404 });
  }

  // 外部 API 执行「发布时快照」（published_data）：发布后继续编辑保存不影响已发布内容
  const workflow: PublishedWorkflow = {
    id: wf.id,
    title: wf.title,
    data: (wf.published_data ?? wf.data) as TinyflowData,
  };

  return { workflow, userId: keyRow.user_id };
}
