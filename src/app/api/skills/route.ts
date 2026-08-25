import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { listSkills, createSkill, ensureWorkflowOwnership } from '@/lib/workflow-skill/skill-store';
import { validateSkillDefinition } from '@/lib/workflow-skill/skill-schema';
import type { SkillDefinitionV1 } from '@/lib/workflow-skill/skill-types';

export const runtime = 'nodejs';

// My Skills：列出 / 创建
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
  const skills = await listSkills(user.id);
  return NextResponse.json(skills);
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.workflowId) {
    return NextResponse.json({ error: 'workflowId 必填（Skill 需绑定一个工作流）' }, { status: 400 });
  }

  const own = await ensureWorkflowOwnership(body.workflowId, user.id);
  if (!own.ok) return NextResponse.json({ error: own.error }, { status: 403 });

  const definition = body.definition as SkillDefinitionV1;
  const v = validateSkillDefinition(definition);
  if (!v.valid) return NextResponse.json({ error: `Skill 定义不合法: ${v.errors.join('；')}` }, { status: 400 });

  const result = await createSkill(user.id, {
    workflowId: body.workflowId,
    workflowVersion: body.workflowVersion ?? null,
    title: body.title,
    definition,
    executionPolicy: body.executionPolicy,
    evaluationRules: body.evaluationRules,
  });
  if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json(result.skill, { status: 201 });
}
