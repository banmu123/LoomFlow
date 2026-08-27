import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { requireEvolutionAccess } from '@/lib/evolution/permissions';
import { applyPatch } from '@/lib/workflow-copilot/patch';
import { validateWorkflow } from '@/lib/tinyflow/schema';
import { computeHash } from '@/lib/workflow-hash';
import type { PatchOperation } from '@/lib/workflow-copilot/patch';
import type { TinyflowData } from '@/lib/tinyflow/types';

export const runtime = 'nodejs';

// POST /api/evolution/proposals/[id]/apply — 用户确认应用
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { data: proposal } = await supabase
    .from('evolution_proposals')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!proposal) return NextResponse.json({ error: '提案不存在' }, { status: 404 });
  if (proposal.status !== 'pending') return NextResponse.json({ error: '提案已处理' }, { status: 400 });

  const access = await requireEvolutionAccess(proposal.workflow_id, 'proposals:write');
  if (access instanceof Response) return access;

  // 加载当前工作流
  const { data: wf } = await supabase
    .from('workflow_history')
    .select('id, user_id, data, title, description')
    .eq('id', proposal.workflow_id)
    .maybeSingle();
  if (!wf) return NextResponse.json({ error: '工作流不存在' }, { status: 404 });

  const current = (wf.data as TinyflowData) || { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
  const operations = proposal.operations as PatchOperation[];

  // Apply + 二次校验
  const applied = applyPatch(current, operations);
  if (applied.errors.length > 0) {
    return NextResponse.json({ error: `Patch 应用失败: ${applied.errors.join('；')}` }, { status: 400 });
  }
  const validation = validateWorkflow(applied.workflow);
  if (!validation.valid) {
    return NextResponse.json(
      { error: `校验失败: ${validation.errors.map((e) => e.message).join('；')}` },
      { status: 400 },
    );
  }

  // 保存新版本
  const newData = applied.workflow;
  const dataHash = computeHash(newData);
  const { error: updErr } = await supabase
    .from('workflow_history')
    .update({ data: newData, data_hash: dataHash, saved: true })
    .eq('id', proposal.workflow_id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  const { data: maxVer } = await supabase
    .from('workflow_versions')
    .select('version')
    .eq('workflow_id', proposal.workflow_id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (maxVer?.version ?? 0) + 1;

  await supabase.from('workflow_versions').insert({
    workflow_id: proposal.workflow_id,
    version,
    title: wf.title,
    description: `Evolution: ${proposal.explanation}`,
    data: newData,
  });

  // 更新 proposal 状态
  await supabase
    .from('evolution_proposals')
    .update({ status: 'applied', applied_version: version, applied_at: new Date().toISOString() })
    .eq('id', id);

  // 更新关联 event 状态
  await supabase
    .from('evolution_events')
    .update({ analysis_status: 'applied', updated_at: new Date().toISOString() })
    .eq('id', proposal.event_id);

  // 审计
  try {
    const { logAudit } = await import('@/lib/audit');
    await logAudit({
      userId: access.result.userId,
      username: '',
      action: 'evolution_proposal_apply',
      detail: { proposalId: id, workflowId: proposal.workflow_id, version },
      ip: 'evolution',
    });
  } catch { /* ignore */ }

  return NextResponse.json({ workflowId: proposal.workflow_id, version, applied: true });
}
