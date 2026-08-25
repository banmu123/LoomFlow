import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { getSkill, updateSkill, deleteSkill, setSkillStatus } from '@/lib/workflow-skill/skill-store';
import { validateSkillDefinition } from '@/lib/workflow-skill/skill-schema';

export const runtime = 'nodejs';

// 获取 / 更新 / 归档删除某个 Skill
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
  const { id } = await params;
  const { skill, error } = await getSkill(id, user.id);
  if (error) return NextResponse.json({ error }, { status: 404 });
  return NextResponse.json(skill);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);

  const result = await updateSkill(id, user.id, {
    title: body?.title,
    definition: body?.definition ? (validateSkillDefinition(body.definition).valid ? body.definition : undefined) : undefined,
    executionPolicy: body?.executionPolicy,
    evaluationRules: body?.evaluationRules,
    workflowId: body?.workflowId,
    workflowVersion: body?.workflowVersion !== undefined ? body.workflowVersion : undefined,
    publishedTargets: body?.publishedTargets,
    status: body?.status,
  });
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result.skill);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
  const { id } = await params;
  const result = await deleteSkill(id, user.id);
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ deleted: id });
}
