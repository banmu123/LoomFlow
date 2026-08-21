import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { getAbilityScores, saveAbilityScores, saveScoreHistory, getScoreHistory, isStale } from '@/lib/growth/ability-service';
import { calculateAllScores } from '@/lib/growth/ability-scoring';
import { determineRole } from '@/lib/growth/ability-roles';
import { getAnswerStats } from '@/lib/growth/question-service';
import { DIMENSIONS, emptyScores } from '@/lib/growth/ability-types';
import type { AbilityDimension, AbilityScores } from '@/lib/growth/ability-types';
import { collectEvidence } from '@/lib/growth/evidence';

export const runtime = 'nodejs';

// GET /api/growth/abilities - 获取用户能力分数
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: '未登录' }, { status: 401 });

  const profile = await getAbilityScores(user.id);
  const stale = await isStale(user.id);

  return Response.json({ profile, stale });
}

// POST /api/growth/abilities - 触发重新分析
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: '未登录' }, { status: 401 });

  const profile = await analyzeAndSave(user.id);
  return Response.json(profile);
}

async function analyzeAndSave(userId: string) {
  const [answerStats, evidence] = await Promise.all([
    getAnswerStats(userId),
    collectEvidence(userId),
  ]);

  const checkinDays = await getCheckinDays(userId);

  const sources = {} as Record<AbilityDimension, { answers: { correct: number; total: number }; checkinDays: number; workflowScore: number }>;
  for (const dim of DIMENSIONS) {
    sources[dim] = {
      answers: answerStats[dim],
      checkinDays: checkinDays[dim] ?? 0,
      workflowScore: getWorkflowScoreForDimension(dim, evidence),
    };
  }

  const scores = calculateAllScores(sources);
  const role = determineRole(scores);
  const engagement = emptyScores();

  await saveAbilityScores(userId, scores, engagement, role.id, role.labelKey);
  await saveScoreHistory(userId, scores, 'analysis');

  return { scores, engagement, role: role.id, roleLabel: role.labelKey, analyzedAt: new Date().toISOString() };
}

async function getCheckinDays(userId: string): Promise<Record<AbilityDimension, number>> {
  const result: Record<AbilityDimension, number> = {} as Record<AbilityDimension, number>;
  for (const dim of DIMENSIONS) result[dim] = 0;
  try {
    const { supabase } = await import('@/lib/supabase/server');
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('answer_records')
      .select('created_at, dimension')
      .eq('user_id', userId)
      .gte('created_at', since);
    const days = new Set<string>();
    for (const r of data ?? []) {
      const day = r.created_at.slice(0, 10);
      days.add(day);
    }
    for (const dim of DIMENSIONS) result[dim] = days.size;
  } catch {
    // ignore
  }
  return result;
}

function getWorkflowScoreForDimension(dim: AbilityDimension, evidence: Record<string, number>): number {
  const mapping: Record<AbilityDimension, string[]> = {
    thinking: ['workflow_edited', 'notes'],
    creativity: ['workflow_created', 'workflow_generated'],
    execution: ['workflow_executed_success', 'api_published'],
    learning: ['practice_completed', 'notes'],
    communication: [],
    resilience: ['workflow_executed'],
  };
  const sources = mapping[dim] ?? [];
  if (sources.length === 0) return 0;
  const total = sources.reduce((sum, s) => sum + (evidence[s] ?? 0), 0);
  return Math.min(total / 10, 1.0);
}
