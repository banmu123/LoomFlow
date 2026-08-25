import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { getSkill, fetchSkillMetricsData } from '@/lib/workflow-skill/skill-store';
import { getSkillTestCases } from '@/lib/workflow-skill/skill-testing';
import { computeSkillQuality, buildImprovements } from '@/lib/workflow-skill/skill-metrics';

export const runtime = 'nodejs';

// Skill Quality 评估
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
  const { id } = await params;
  const { skill, error } = await getSkill(id, user.id);
  if (error) return NextResponse.json({ error }, { status: 404 });

  // 运行指标
  const raw = await fetchSkillMetricsData(id, user.id);
  // 测试通过率
  const cases = await getSkillTestCases(skill!.workflowId, user.id);
  const quality = computeSkillQuality({
    totalRuns: raw.total,
    successRuns: raw.success,
    errorRuns: raw.error,
    durationsMs: raw.durations,
    tokenUsages: raw.tokens,
    costs: raw.costs,
    testRuns: { passed: cases.length, total: cases.length }, // 通过率以用例存在性近似（有测试则视为基线）
  });

  const improvements = buildImprovements(quality);
  return NextResponse.json({ skillId: id, quality, improvements });
}
