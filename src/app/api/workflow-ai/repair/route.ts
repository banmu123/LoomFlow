import { NextRequest } from 'next/server';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import { validateWorkflow } from '@/lib/tinyflow/schema';
import { getCurrentUser } from '@/lib/server-auth';

export const runtime = 'nodejs';

function getProvider() {
  const arkKey = process.env.ARK_API_KEY;
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const apiKey = arkKey || deepseekKey || '';
  const baseURL = arkKey
    ? process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3'
    : process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
  return createOpenAICompatible({ baseURL, apiKey, name: 'ai-provider' });
}

function extractJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      try {
        return JSON.parse(match[1].trim());
      } catch {
        // ignore
      }
    }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // ignore
      }
    }
    return null;
  }
}

const REPAIR_SYSTEM_PROMPT = `你是一个工作流 JSON 修复器。你的任务：
1. 分析给定的工作流 JSON 和它存在的问题列表
2. 修复所有问题（如：未知节点类型改为正确的类型、补充缺失字段、删除悬空连接等）
3. 只输出修复后的完整 JSON，不要任何解释、不要代码块标记
4. 保持原有结构（nodes / edges / viewport），只做必要修改`;

// 修复 AI 生成的工作流 JSON（自动校验 → 修复）
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const workflow = body?.workflow;
  const errors: string[] = Array.isArray(body?.errors) ? body.errors : [];

  if (!workflow || errors.length === 0) {
    return Response.json({ error: 'workflow 和 errors 不能为空' }, { status: 400 });
  }

  try {
    const provider = getProvider();
    const modelId = 'deepseek-v4-flash';

    const { text } = await generateText({
      model: provider(modelId),
      system: REPAIR_SYSTEM_PROMPT,
      prompt: `工作流 JSON:\n${JSON.stringify(workflow, null, 2)}\n\n存在的问题:\n${errors
        .map((e) => `- ${e}`)
        .join('\n')}`,
      temperature: 0.1,
      maxOutputTokens: 8192,
    });

    const repaired = extractJSON(text);
    if (!repaired) {
      return Response.json({ error: '修复失败：无法解析 AI 输出' }, { status: 500 });
    }

    // 二次校验
    const validation = validateWorkflow(repaired);
    return Response.json({
      workflow: repaired,
      valid: validation.valid,
      errors: validation.errors.map((e) => e.message),
    });
  } catch (err) {
    return Response.json(
      { error: `修复失败: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
