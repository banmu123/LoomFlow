import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { supabase } from '@/lib/supabase/server';
import { buildProposal } from '@/lib/workflow-copilot/proposal';
import { applyPatch, PatchOperation } from '@/lib/workflow-copilot/patch';
import { diffToMarkdown } from '@/lib/workflow-copilot/diff';
import {
  ensureWorkflowOwnership,
  listTestCases,
  getWorkflowDataAtVersion,
} from '@/lib/workflow-copilot/test-case-store';
import { serializeWorkflow } from '@/lib/tinyflow/schema';
import type { TinyflowData } from '@/lib/tinyflow/types';

export const runtime = 'nodejs';

/**
 * AI Proposal（Part 5）
 * body:
 *   workflowId (必填)
 *   operations: PatchOperation[]  AI 输出的 patch
 *   runTests?: boolean  是否执行测试（缺省 false）
 *   description?: string
 *
 * 产出 Proposal（含 diff / 校验 / 测试），但【不落库】——由用户批准后调版本保存接口生成新版本。
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

  const own = await ensureWorkflowOwnership(workflowId, user.id);
  if (!own.ok) return NextResponse.json({ error: own.error }, { status: 403 });

  // 取当前工作流（作为 fromVersion 基准）
  const { data: wf } = await supabase
    .from('workflow_history')
    .select('data')
    .eq('id', workflowId)
    .maybeSingle();
  const current = ((wf?.data ?? null) as TinyflowData) || { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };

  // 获取可运行的测试用例
  const tests = body.runTests ? await listTestCases(workflowId, user.id) : [];

  const proposal = await buildProposal(current, operations, {
    workflowId,
    fromVersion: body.fromVersion,
    tests,
    runTests: !!body.runTests,
    description: body.description,
  });

  // AI 可读的 patch 表示
  const patch = { operations, appliedCount: applyPatch(current, operations).appliedCount };

  return NextResponse.json({
    ...proposal,
    patch,
    markdown: diffToMarkdown(proposal.diff),
    canSave: proposal.schema.valid && !proposal.issues.some((i) => i.level === 'error'),
  });
}

// 让 serializeWorkflow 在需要时可用（规范化待提交的版本）
export { serializeWorkflow };
