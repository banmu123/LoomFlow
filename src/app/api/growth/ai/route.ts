import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { getProviderClientForModel } from '@/lib/ai';
import { getAllModels } from '@/lib/ai/db-models';
import { generateText } from 'ai';
import {
  buildGoalPrompt,
  buildJourneyPrompt,
  parseGeneratedJson,
  normalizeGeneratedGoal,
  normalizeGeneratedJourney,
} from '@/lib/growth/ai-generate';
import { getGoal } from '@/lib/growth/growth-service';
import type { GeneratedGoal, GeneratedJourney } from '@/lib/growth/ai-generate';

export const runtime = 'nodejs';

// ===== Growth AI 生成端点 =====
// POST /api/growth/ai  { action: 'goal' | 'journey', input, goalId? }
// 返回结构化 JSON（不落库）——前端展示确认后调用创建 API 保存

async function callModel(system: string, prompt: string): Promise<string> {
  const allModels = await getAllModels();
  if (allModels.length === 0) {
    throw new Error('尚未配置模型，请先在「模型配置」中添加');
  }
  const model = allModels[0];
  const provider = getProviderClientForModel(model);
  if (!provider) throw new Error(`未知 provider: ${model.provider}`);
  const { text } = await generateText({
    model: provider(model.id),
    system,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.6,
    maxOutputTokens: 2048,
  });
  return text;
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const action = body?.action as string | undefined;
  const input = typeof body?.input === 'string' ? body.input.trim() : '';

  try {
    if (action === 'goal') {
      if (!input) return Response.json({ error: '缺少目标描述' }, { status: 400 });
      const raw = await callModel('你是成长目标规划助手，只输出 JSON。', buildGoalPrompt(input));
      const parsed = parseGeneratedJson<unknown>(raw);
      const goal = normalizeGeneratedGoal(parsed);
      if (!goal) return Response.json({ error: 'AI 生成结果无法解析，请重试' }, { status: 422 });
      return Response.json({ action: 'goal', data: goal satisfies GeneratedGoal });
    }

    if (action === 'journey') {
      const goalId = (body?.goalId || '').trim();
      if (!goalId) return Response.json({ error: '缺少 goalId' }, { status: 400 });
      const goal = await getGoal(goalId, user.id);
      if (!goal) return Response.json({ error: '目标不存在或无权访问' }, { status: 403 });
      const raw = await callModel('你是学习路径规划助手，只输出 JSON。', buildJourneyPrompt(goal));
      const parsed = parseGeneratedJson<unknown>(raw);
      const journey = normalizeGeneratedJourney(parsed);
      if (!journey) {
        return Response.json({ error: 'AI 生成结果无法解析，请重试' }, { status: 422 });
      }
      return Response.json({ action: 'journey', data: journey satisfies GeneratedJourney });
    }

    return Response.json({ error: '未知 action' }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'AI 生成失败';
    return Response.json({ error: msg }, { status: 500 });
  }
}
