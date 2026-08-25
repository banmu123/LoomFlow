import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { getSkill } from '@/lib/workflow-skill/skill-store';
import {
  getSkillTestCases,
  runSkillTests,
  canPublish,
  getWorkflowDataAtVersion,
} from '@/lib/workflow-skill/skill-testing';

export const runtime = 'nodejs';

// Skill 测试：列出绑定测试用例 / 运行动态
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
  const { id } = await params;
  const { skill, error } = await getSkill(id, user.id);
  if (error) return NextResponse.json({ error }, { status: 404 });
  const cases = await getSkillTestCases(skill!.workflowId, user.id);
  return NextResponse.json({ skillId: id, testCases: cases, boundWorkflow: skill!.workflowId });
}

// 运行 Skill 绑定的全部测试
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
  const { id } = await params;
  const { skill, error } = await getSkill(id, user.id);
  if (error) return NextResponse.json({ error }, { status: 404 });

  const { data, error: verErr } = await getWorkflowDataAtVersion(
    skill!.workflowId,
    user.id,
    skill!.workflowVersion,
  );
  if (verErr || !data) return NextResponse.json({ error: verErr ?? '无法读取工作流' }, { status: 400 });

  const outcome = await runSkillTests(skill!.workflowId, user.id, data as never);
  const gate = canPublish(outcome);
  return NextResponse.json({ skillId: id, outcome, canPublish: gate.ok, publishReason: gate.reason });
}
