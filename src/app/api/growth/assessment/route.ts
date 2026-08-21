import { getCurrentUser } from '@/lib/server-auth';
import { generateAssessmentQuestions } from '@/lib/growth/ai-assessment';

export const runtime = 'nodejs';

// GET /api/growth/assessment - 获取自评题目
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: '未登录' }, { status: 401 });

  try {
    const questions = await generateAssessmentQuestions();
    if (questions.length === 0) {
      return Response.json({
        error: '题目生成失败，请检查模型配置是否正确',
        hint: '请确认：1) 管理后台已配置模型 2) 模型 API Key 有效 3) baseURL 正确（通常需要 /v1 后缀）',
      }, { status: 500 });
    }

    return Response.json(questions);
  } catch (err) {
    console.error('[assessment] Error:', err);
    return Response.json({
      error: '题目生成失败',
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
