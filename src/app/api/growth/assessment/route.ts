import { getCurrentUser } from '@/lib/server-auth';
import { generateAssessmentQuestions, analyzeAssessmentResults } from '@/lib/growth/ai-assessment';
import type { AssessmentQuestion, AssessmentAnswer } from '@/lib/growth/ai-assessment';

export const runtime = 'nodejs';

// GET /api/growth/assessment - 获取自评题目
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: '未登录' }, { status: 401 });

  const questions = await generateAssessmentQuestions();
  if (questions.length === 0) {
    return Response.json({ error: '题目生成失败，请稍后重试' }, { status: 500 });
  }

  return Response.json(questions);
}
