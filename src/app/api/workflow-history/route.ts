import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';
import { computeHash } from '@/lib/workflow-hash';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  // 完全隔离：所有用户（含 admin）只能看到自己的工作流
  // 不返回 api_key（安全：全局 Key 仅在生成/重新生成响应中显示一次）
  const { data, error } = await supabase
    .from('workflow_history')
    .select(
      'id, title, description, data, created_at, updated_at, published, share_token',
    )
    .eq('saved', true)
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data);
}

// 保存工作流：
// - 带 id（从列表打开画布）：更新当前工作流记录（不新增列表条目），并记录版本快照
// - 不带 id（AI 生成/新建）：首次创建记录，并记录版本 1
// 每次保存都会写入 workflow_versions（版本历史），用于「查看历史修改」与还原
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);

  if (!body?.data) {
    return Response.json({ error: 'data 不能为空' }, { status: 400 });
  }

  const dataHash = computeHash(body.data);
  let title = body.title?.trim() || '未命名工作流';
  let description = body.description?.trim() || null;

  let record: Record<string, unknown>;
  let created = false;

  if (body.id) {
    // 已有工作流：更新当前记录（校验归属）；未传 title/description 时保留原值
    const { data: existing } = await supabase
      .from('workflow_history')
      .select('id, user_id, title, description')
      .eq('id', body.id)
      .single();

    if (!existing) {
      return Response.json({ error: '工作流不存在' }, { status: 404 });
    }
    if (existing.user_id !== user.id) {
      return Response.json({ error: '无权操作该工作流' }, { status: 403 });
    }

    const updates: Record<string, unknown> = {
      data: body.data,
      data_hash: dataHash,
      saved: true,
    };
    if (body.title?.trim()) updates.title = body.title.trim();
    if (typeof body.description === 'string') {
      updates.description = body.description.trim() || null;
    }

    const { data: updated, error: updateErr } = await supabase
      .from('workflow_history')
      .update(updates)
      .eq('id', body.id)
      .select('id, title, description, created_at, updated_at, published, share_token')
      .single();

    if (updateErr) {
      return Response.json({ error: updateErr.message }, { status: 500 });
    }
    record = updated;
    title = (updates.title as string | undefined) ?? existing.title;
    description = (updates.description as string | null | undefined) ?? existing.description;
  } else {
    // 首次保存：创建新记录
    const { data: inserted, error: insertErr } = await supabase
      .from('workflow_history')
      .insert({
        title,
        description,
        data: body.data,
        data_hash: dataHash,
        conversation_id: body.conversation_id || null,
        user_id: user.id,
        saved: true,
      })
      .select('id, title, description, created_at, updated_at, published, share_token')
      .single();

    if (insertErr) {
      return Response.json({ error: insertErr.message }, { status: 500 });
    }
    record = inserted;
    created = true;
  }

  // 写入版本快照（version = 已有最大版本 + 1）
  const { data: maxVer } = await supabase
    .from('workflow_versions')
    .select('version')
    .eq('workflow_id', record.id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  const version = (maxVer?.version ?? 0) + 1;

  const { error: verErr } = await supabase.from('workflow_versions').insert({
    workflow_id: record.id,
    version,
    title,
    description,
    data: body.data,
  });

  if (verErr) {
    const isMissingTable = /relation "workflow_versions" does not exist/.test(
      verErr.message,
    );
    return Response.json(
      {
        error: isMissingTable
          ? '数据库缺少 workflow_versions 表：请在 Supabase SQL Editor 执行 scripts/supabase-versions.sql 完成迁移（或 docker exec -i loomflow-postgres psql -U postgres -d loomflow < scripts/supabase-versions.sql）'
          : verErr.message,
      },
      { status: 500 },
    );
  }

  return Response.json({ ...record, version }, { status: created ? 201 : 200 });
}
