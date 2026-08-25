import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { getCurrentUser } from '@/lib/server-auth';
import { getProviderClientForModel } from '@/lib/ai';
import { getAllModels } from '@/lib/ai/db-models';
import { getEnabledSearchProviders } from '@/lib/search/db-providers';
import { buildSystemPrompt } from '@/lib/workflow-ai/prompts';
import { validateWorkflow } from '@/lib/tinyflow/schema';
import { validateSkillDefinition } from '@/lib/workflow-skill/skill-schema';
import type { SkillDefinitionV1 } from '@/lib/workflow-skill/skill-types';
import type { TinyflowData } from '@/lib/tinyflow/types';

export const runtime = 'nodejs';

function extractJSON<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      try {
        return JSON.parse(match[1].trim()) as T;
      } catch {
        return null;
      }
    }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * 自然语言 → Skill（Part 六：一句话创建可复用的 AI 能力）
 *
 * 流程：NL → Skill Intent（SkillDefinition + Workflow）→ Validation → Test → 用户批准 → 发布
 * 本端点产出「skillDraft」（definition + workflow + 校验结果），供用户审阅后再走 skills 创建/发布。
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const userRequest = String(body?.message || body?.request || '').trim();
  if (!userRequest) return NextResponse.json({ error: '请描述你想自动化的能力' }, { status: 400 });

  const allModels = await getAllModels();
  if (allModels.length === 0) {
    return NextResponse.json({ error: '尚未配置模型，请先在「模型配置」中添加' }, { status: 400 });
  }
  const modelId = allModels[0].id;
  const activeModel = allModels.find((m) => m.id === modelId);
  if (!activeModel) return NextResponse.json({ error: '未知模型' }, { status: 400 });
  const provider = getProviderClientForModel(activeModel);
  if (!provider) return NextResponse.json({ error: `未知 provider: ${activeModel.provider}` }, { status: 500 });

  const searchProviders = (await getEnabledSearchProviders()).map((s) => ({ id: s.id, label: s.label }));
  const basePrompt = buildSystemPrompt(
    allModels.map((m) => ({ id: m.id, label: m.label })),
    searchProviders,
  );

  const taskPrompt = `用户需求：${userRequest}

请把用户的一句话需求，封装成一个「可复用的 Skill」。你需要同时给出：
1. Skill 定义（name / description / inputs / outputs / examples / constraints）
2. 一个完整可执行的 Tinyflow 工作流 JSON（nodes / edges / viewport）

## 输出格式（严格 JSON，不要输出 JSON 之外文字）
{
  "skill": {
    "name": "简短产品名（如 AI News Summarizer）",
    "description": "这个 Skill 做什么",
    "inputs": { "fields": [ { "name", "type", "required", "description", "label", "placeholder", "defaultValue"? } ] },
    "outputs": { "fields": [ { "name", "type", "description" } ] },
    "examples": [ { "inputs": {...}, "outputs": {...}, "description" } ],
    "usageInstructions": "使用说明",
    "constraints": ["局限/边界"]
  },
  "workflow": { "nodes": [...], "edges": [...], "viewport": {...} }
}

## 规则
- input 的字段就是工作流 startNode 的输入参数（refType=ref, ref="input.字段名"）
- output 字段应映射到 endNode 的输出（ref 引用上游）
- workflow 必须通过校验：节点 id 唯一、start/end 各一个、边无悬空、无环
- Skill 名用英文短名，description 用中文或与用户一致的语言`;

  let text: string;
  try {
    const result = await generateText({
      model: provider(modelId),
      system: `${basePrompt}\n\n你现在是一个 Skill 打包器：把工作流封装成一个普通用户可反复使用的 AI 能力。`,
      prompt: taskPrompt,
      temperature: 0.4,
      maxOutputTokens: 8192,
    });
    text = result.text;
  } catch (err) {
    return NextResponse.json({ error: `AI 调用失败: ${(err as Error).message}` }, { status: 500 });
  }

  const parsed = extractJSON<{ skill?: SkillDefinitionV1; workflow?: TinyflowData }>(text);
  if (!parsed?.skill || !parsed.workflow) {
    return NextResponse.json({ error: 'AI 输出无法解析，请重试' }, { status: 500 });
  }

  // 校验 Skill 定义 + 工作流
  const skillValid = validateSkillDefinition(parsed.skill);
  const workflowValid = validateWorkflow(parsed.workflow);

  return NextResponse.json({
    kind: 'skill_draft',
    skill: parsed.skill,
    workflow: parsed.workflow,
    validation: {
      skill: skillValid,
      workflow: { valid: workflowValid.valid, errors: workflowValid.errors.map((e) => e.message) },
      canCreate: skillValid.valid && workflowValid.valid,
    },
    message: '这是 AI 生成的 Skill 草稿（Skill 定义 + 工作流），请审阅后确认；确认后才创建。',
  });
}
