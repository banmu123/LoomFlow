import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { generateAssessmentQuestions } from '@/lib/growth/ai-assessment';

export const runtime = 'nodejs';

// GET /api/growth/assessment - 获取自评题目
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: '未登录' }, { status: 401 });

  const modelId = request.nextUrl.searchParams.get('modelId') ?? undefined;

  try {
    const questions = await generateAssessmentQuestions(modelId);
    if (questions.length === 0) {
      return Response.json({
        error: '题目生成失败，AI 返回为空',
      }, { status: 500 });
    }

    return Response.json(questions);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[assessment] Error:', detail);
    return Response.json({
      error: detail || '题目生成失败，请检查模型配置',
    }, { status: 500 });
  }
}
