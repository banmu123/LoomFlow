import { NextRequest } from 'next/server';
import { streamText } from 'ai';
import type { ModelMessage } from 'ai';
import { getCurrentUser } from '@/lib/server-auth';
import { getProviderClientForModel } from '@/lib/ai';
import { getAllModels } from '@/lib/ai/db-models';

export const runtime = 'nodejs';

// ===== Code Lab AI Mentor =====
// POST /api/code-lab/mentor  { action: hint|explain|review|debug, code, tests, output, error }
// 原则：默认引导（Hint/Explain），不直接给完整答案——除非用户明确要求完整代码。

const MENTOR_RULES = {
  hint: '给出方向性提示（思路/关键点/常见错误），不要写完整代码。',
  explain: '逐段解释代码在做什么（概念/语法/思路），可给简短示例片段，不要直接给整题答案。',
  review: '审查代码：指出问题/改进点/风险，按重要性列出。不要直接重写全部代码。',
  debug: '分析报错/异常输出，指出根因与排查方向；可给最小修复片段，不要直接给完整重写。',
};

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…（已截断）` : s;
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const action = (body?.action as string | undefined) || 'hint';
  const code = truncate(String(body?.code ?? ''), 8000);
  const tests = truncate(String(body?.tests ?? ''), 4000);
  const output = truncate(String(body?.output ?? ''), 4000);
  const error = truncate(String(body?.error ?? ''), 2000);

  if (!code.trim()) {
    return Response.json({ error: '代码不能为空' }, { status: 400 });
  }
  if (!['hint', 'explain', 'review', 'debug'].includes(action)) {
    return Response.json({ error: '未知 action' }, { status: 400 });
  }

  const allModels = await getAllModels();
  if (allModels.length === 0) {
    return Response.json(
      { error: '尚未配置模型，请先在「模型配置」中添加' },
      { status: 400 },
    );
  }
  const model = allModels[0];
  const provider = getProviderClientForModel(model);
  if (!provider) {
    return Response.json({ error: `未知 provider: ${model.provider}` }, { status: 500 });
  }

  const system = `你是 LoomFlow Code Lab 的 AI 导师，帮助用户在沙箱里学习 JavaScript/TypeScript 编程。
${MENTOR_RULES[action as keyof typeof MENTOR_RULES]}
规则：
1. 先引导用户自己思考，提供提示而不是直接给答案
2. 只有当用户明确说"给我完整代码/直接写出来"时才给完整实现
3. 回答简洁、可操作，使用用户的语言
4. 涉及错误时先解释原因再给修复方向`;

  const context = [
    `【用户代码】\n${code}`,
    tests ? `【测试代码】\n${tests}` : '',
    output ? `【运行输出】\n${output}` : '',
    error ? `【执行错误】\n${error}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const result = streamText({
    model: provider(model.id),
    system,
    messages: [{ role: 'user', content: context }] as ModelMessage[],
    temperature: 0.5,
    maxOutputTokens: 2048,
  });

  return result.toUIMessageStreamResponse({ sendReasoning: false });
}
