import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { analyzeAssessmentResults } from '@/lib/growth/ai-assessment';
import type { AssessmentQuestion, AssessmentAnswer } from '@/lib/growth/ai-assessment';
import { saveAbilityScores, saveScoreHistory } from '@/lib/growth/ability-service';
import { determineRole } from '@/lib/growth/ability-roles';
import { emptyEngagement, DIMENSIONS } from '@/lib/growth/ability-types';
import type { AbilityScores } from '@/lib/growth/ability-types';

export const runtime = 'nodejs';

// POST /api/growth/assessment/analyze - 提交自评答案并分析
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: '未登录' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const questions = body?.questions as AssessmentQuestion[] | undefined;
  const answers = body?.answers as AssessmentAnswer[] | undefined;

  if (!Array.isArray(questions) || !Array.isArray(answers)) {
    return Response.json({ error: '缺少 questions 或 answers' }, { status: 400 });
  }

  const result = await analyzeAssessmentResults(questions, answers);
  if (!result) {
    return Response.json({ error: '分析失败，请稍后重试' }, { status: 500 });
  }

  const scores: AbilityScores = {
    thinking: result.scores.thinking ?? 50,
    creativity: result.scores.creativity ?? 50,
    execution: result.scores.execution ?? 50,
    learning: result.scores.learning ?? 50,
    communication: result.scores.communication ?? 50,
    resilience: result.scores.resilience ?? 50,
  };
  const role = determineRole(scores);
  await saveAbilityScores(user.id, scores, emptyEngagement(), role.id, role.labelKey);
  await saveScoreHistory(user.id, scores, 'assessment');

  return Response.json({
    scores,
    analysis: result.analysis,
    role: role.id,
    roleLabel: role.labelKey,
  });
}
