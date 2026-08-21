import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { saveAbilityScores, saveScoreHistory } from '@/lib/growth/ability-service';
import { determineRole } from '@/lib/growth/ability-roles';
import { emptyEngagement } from '@/lib/growth/ability-types';
import type { AbilityScores } from '@/lib/growth/ability-types';
import { DIMENSIONS } from '@/lib/growth/ability-types';

export const runtime = 'nodejs';

// POST /api/growth/abilities/init - 初始化能力分数（自评后）
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: '未登录' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const scores = body?.scores as AbilityScores | undefined;
  const source = typeof body?.source === 'string' ? body.source : 'assessment';

  if (!scores || typeof scores !== 'object') {
    return Response.json({ error: '缺少 scores' }, { status: 400 });
  }

  // 验证每个维度的分数在 0-100 范围内
  for (const dim of DIMENSIONS) {
    const val = scores[dim];
    if (typeof val !== 'number' || val < 0 || val > 100) {
      return Response.json({ error: `${dim} 分数不合法` }, { status: 400 });
    }
  }

  const role = determineRole(scores);
  await saveAbilityScores(user.id, scores, emptyEngagement(), role.id, role.labelKey);
  await saveScoreHistory(user.id, scores, source);

  return Response.json({ scores, role: role.id, roleLabel: role.labelKey });
}
