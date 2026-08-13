import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';
import { computeHash } from '@/lib/workflow-hash';

// 工作流版本历史列表（按版本倒序，含 data 快照，供前端预览/还原到画布）
// 返回 is_current：内容与当前工作流一致的版本（即"当前保存/发布的版本"）
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const { id } = await params;

  // 校验归属：仅工作流主人可查看版本
  const { data: wf } = await supabase
    .from('workflow_history')
    .select('id, user_id, data, published')
    .eq('id', id)
    .single();

  if (!wf) {
    return Response.json({ error: '工作流不存在' }, { status: 404 });
  }
  if (wf.user_id !== user.id) {
    return Response.json({ error: '无权操作该工作流' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('workflow_versions')
    .select('id, version, title, description, data, created_at')
    .eq('workflow_id', id)
    .order('version', { ascending: false });

  if (error) {
    const isMissingTable = /relation "workflow_versions" does not exist/.test(
      error.message,
    );
    return Response.json(
      {
        error: isMissingTable
          ? '数据库缺少 workflow_versions 表：请在 Supabase SQL Editor 执行 scripts/supabase-versions.sql 完成迁移'
          : error.message,
      },
      { status: 500 },
    );
  }

  // 对比内容：与当前工作流 data 一致的版本标记为 is_current（"当前保存/发布的版本"）
  const currentHash = computeHash(wf.data);
  const enriched = (data ?? []).map((v: { data: unknown; version: number }) => ({
    ...v,
    is_current: computeHash(v.data) === currentHash,
    published: !!wf.published,
  }));

  return Response.json(enriched);
}
