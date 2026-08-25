import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { getSkill } from '@/lib/workflow-skill/skill-store';
import { getSkillEval } from '@/lib/workflow-eval/store';
import { evaluateRun, evalToText } from '@/lib/workflow-eval/eval-model';
import type { EvalRange } from '@/lib/workflow-eval/metrics';

export const runtime = 'nodejs';

const RANGES = new Set(['24h', '7d', '30d']);

// Skill Evaluation（Part 十）：Skill 继承 Workflow Evaluation
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
  const { id } = await params;

  const { skill, error } = await getSkill(id, user.id);
  if (error) return NextResponse.json({ error }, { status: 404 });

  const range = (request.nextUrl.searchParams.get('range') || '7d') as EvalRange;
  if (!RANGES.has(range)) return NextResponse.json({ error: 'range 非法' }, { status: 400 });

  const evalData = await getSkillEval(id, user.id, range);
  const lastRun = evalData.selectedRuns[evalData.selectedRuns.length - 1];
  const evaluation = lastRun ? evaluateRun(null, lastRun.status) : null;

  // 也读取绑定工作流的节点级 trace（若有配 trace 的 run 才能分析节点）
  const nodeEval = evalData.workflow;

  return NextResponse.json({
    skillId: id,
    range,
    title: skill!.title,
    metrics: evalData.workflow,
    lastEvaluation: evaluation,
    lastEvaluationText: evaluation ? evalToText(evaluation) : null,
    note: 'Skill 指标来自 skill_runs 历史；如需节点级瓶颈分析请查看其绑定工作流 /api/eval/workflows/[workflowId]',
    boundWorkflow: skill!.workflowId,
  });
}