import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { getSkill, listSkillVersions } from '@/lib/workflow-skill/skill-store';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
  const { id } = await params;
  const { skill, error } = await getSkill(id, user.id);
  if (error) return NextResponse.json({ error }, { status: 404 });
  const versions = await listSkillVersions(id, user.id);
  return NextResponse.json({ skill: { version: skill!.version, workflowVersion: skill!.workflowVersion }, versions });
}
