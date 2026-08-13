import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';
import { logAudit, getClientIp } from '@/lib/audit';
import { ensureUserApiKey } from '@/lib/api-key';
import { formatVersion } from '@/lib/version';

// 发布工作流：标记 published=true。
// 全局 API Key 在首次发布时自动生成，仅在生成当次响应中返回（只显示一次）；
// 已生成过 Key 的用户再次发布不返回 Key。
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const { id } = await params;

  // 校验归属：仅工作流主人可发布
  const { data: wf } = await supabase
    .from('workflow_history')
    .select('id, user_id, title')
    .eq('id', id)
    .single();

  if (!wf) {
    return Response.json({ error: '工作流不存在' }, { status: 404 });
  }
  if (wf.user_id !== user.id) {
    return Response.json({ error: '无权操作该工作流' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);

  // 确保全局 API Key 存在（有效期配置仅在首次生成时生效）
  const { created, api_key } = await ensureUserApiKey(user.id, {
    expires_days: typeof body?.expires_days === 'number' ? body.expires_days : undefined,
  });

  // 发布指定版本：body.version 存在时，用该版本的快照作为发布内容（published_version 记录版本号）
  // 不传 version = 发布当前内容（published_version 置空）
  // 发布内容写入 published_data 快照：后续保存不覆盖，外部 API 始终执行发布的那份
  let publishedData: unknown;
  const updates: Record<string, unknown> = {
    published: true,
    published_version: null,
  };
  if (typeof body?.version === 'number') {
    const { data: ver } = await supabase
      .from('workflow_versions')
      .select('data')
      .eq('workflow_id', id)
      .eq('version', body.version)
      .single();

    if (!ver) {
      return Response.json(
        { error: `版本 v${formatVersion(body.version)} 不存在` },
        { status: 400 },
      );
    }
    publishedData = ver.data;
    updates.published_version = body.version;
  }

  if (publishedData === undefined) {
    // 发布当前内容：读当前 workflow_history.data 作为快照
    const { data: cur } = await supabase
      .from('workflow_history')
      .select('data')
      .eq('id', id)
      .single();
    publishedData = cur?.data ?? null;
  }
  updates.published_data = publishedData;

  const { data, error } = await supabase
    .from('workflow_history')
    .update(updates)
    .eq('id', id)
    .select('id, title, published, published_version')
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  await logAudit({
    userId: user.id,
    username: user.username,
    action: 'workflow_publish',
    detail: {
      workflowId: id,
      title: wf.title,
      apiKeyCreated: created,
      publishedVersion: updates.published_version ?? null,
    },
    ip: getClientIp(request),
  });

  // api_key 仅在首次生成时非空（只显示一次）
  return Response.json({ ...data, api_key: created ? api_key : null });
}
