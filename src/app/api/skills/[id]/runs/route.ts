import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { getSkill, listSkillRuns } from '@/lib/workflow-skill/skill-store';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
  const { id } = await params;
  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') || 50), 200);
  const { skill, error } = await getSkill(id, user.id);
  if (error) return NextResponse.json({ error }, { status: 404 });
  const runs = await listSkillRuns(id, user.id, limit);
  return NextResponse.json({ skillId: id, runs });
}
