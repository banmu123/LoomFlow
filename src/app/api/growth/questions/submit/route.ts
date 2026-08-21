import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { submitAnswer } from '@/lib/growth/question-service';
import { saveAbilityScores, saveScoreHistory, getAbilityScores } from '@/lib/growth/ability-service';
import { determineRole } from '@/lib/growth/ability-roles';
import { DIMENSIONS, emptyScores } from '@/lib/growth/ability-types';
import type { AbilityDimension } from '@/lib/growth/ability-types';
import { getAnswerStats } from '@/lib/growth/question-service';

export const runtime = 'nodejs';

// POST /api/growth/questions/submit - 提交答案
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: '未登录' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.questionId || !body?.answer) {
    return Response.json({ error: '缺少 questionId 或 answer' }, { status: 400 });
  }

  const result = await submitAnswer(user.id, body.questionId, body.answer);

  await updateScoresAfterAnswer(user.id, body.questionId, result.correct);

  return Response.json(result);
}

async function updateScoresAfterAnswer(userId: string, questionId: string, correct: boolean) {
  if (!correct) return;

  const { supabase } = await import('@/lib/supabase/server');
  const { data: question } = await supabase
    .from('question_bank')
    .select('dimension')
    .eq('id', questionId)
    .maybeSingle();
  if (!question) return;

  const dimension = question.dimension as AbilityDimension;

  const answerStats = await getAnswerStats(userId);
  const existing = await getAbilityScores(userId);
  const scores = existing?.scores ?? emptyScores();

  const correctCount = answerStats[dimension].correct;
  const bonus = Math.min(correctCount * 2, 20);
  scores[dimension] = Math.min(100, scores[dimension] + bonus);

  const role = determineRole(scores);
  await saveAbilityScores(userId, scores, existing?.engagement ?? emptyScores(), role.id, role.labelKey);
  await saveScoreHistory(userId, scores, 'answer', dimension);
}
