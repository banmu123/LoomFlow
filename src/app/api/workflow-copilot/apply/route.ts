import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { supabase } from '@/lib/supabase/server';
import { applyPatch } from '@/lib/workflow-copilot/patch';
import { validateWorkflow } from '@/lib/tinyflow/schema';
import { computeHash } from '@/lib/workflow-hash';
import type { PatchOperation } from '@/lib/workflow-copilot/patch';
import type { TinyflowData } from '@/lib/tinyflow/types';

export const runtime = 'nodejs';

/**
 * 用户批准后持久化 AI Proposal（Part 5/10）
 *
 * body:
 *   workflowId (必填)
 *   operations: PatchOperation[]
 *   title? / description?（元数据更新，可选）
 *   note?（可选：记录本次 AI 修改来源）
 *
 * 流程：apply 到新快照 → schema 校验 → 生成新版本（不覆盖「历史版本」，只是把提案存为新版本 + 更新当前 data）
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const workflowId = body?.workflowId as string | undefined;
  const operations = body?.operations as PatchOperation[] | undefined;
  if (!workflowId || !Array.isArray(operations)) {
    return NextResponse.json({ error: 'workflowId 与 operations 必填' }, { status: 400 });
  }

  // 归属校验
  const { data: wf } = await supabase
    .from('workflow_history')
    .select('id, user_id, data, title, description')
    .eq('id', workflowId)
    .maybeSingle();
  if (!wf) return NextResponse.json({ error: '工作流不存在' }, { status: 404 });
  if (wf.user_id !== user.id) return NextResponse.json({ error: '无权操作' }, { status: 403 });

  const current = (wf.data as TinyflowData) || { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };

  // 应用到副本并二次校验（安全：批准落库前再校验一次，AI 不能绕过校验）
  const applied = applyPatch(current, operations);
  if (applied.errors.length > 0) {
    return NextResponse.json({ error: `Patch 应用失败: ${applied.errors.join('；')}` }, { status: 400 });
  }
  const validation = validateWorkflow(applied.workflow);
  if (!validation.valid) {
    return NextResponse.json(
      { error: `校验失败，拒绝保存: ${validation.errors.map((e) => e.message).join('；')}` },
      { status: 400 },
    );
  }

  const newData = applied.workflow;
  const dataHash = computeHash(newData);
  const title = body.title?.trim() || wf.title || '未命名工作流';
  const description =
    typeof body.description === 'string' ? body.description.trim() || null : wf.description ?? null;

  // 更新当前 data（规范化 + 元数据），再写入新版本快照
  const { error: updErr } = await supabase
    .from('workflow_history')
    .update({ data: newData, data_hash: dataHash, title, description, saved: true })
    .eq('id', workflowId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  const { data: maxVer } = await supabase
    .from('workflow_versions')
    .select('version')
    .eq('workflow_id', workflowId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (maxVer?.version ?? 0) + 1;

  const { error: verErr } = await supabase.from('workflow_versions').insert({
    workflow_id: workflowId,
    version,
    title,
    description,
    data: newData,
  });
  if (verErr) return NextResponse.json({ error: verErr.message }, { status: 500 });

  // 审计（可选，失败不影响保存）
  try {
    const { logAudit } = await import('@/lib/audit');
    await logAudit({
      userId: user.id,
      username: user.username,
      action: 'workflow_ai_patch_apply',
      detail: { workflowId, version, ops: operations.length, note: body.note ?? null },
      ip: 'ai-copilot',
    });
  } catch {
    // ignore audit failure
  }

  return NextResponse.json({ workflowId, version, saved: true });
}
