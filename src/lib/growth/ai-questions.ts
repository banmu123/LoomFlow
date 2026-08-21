import { streamText } from 'ai';
import { getProviderClientForModel } from '@/lib/ai/providers';
import { getAllModels } from '@/lib/ai/db-models';
import type { AbilityDimension } from './ability-types';
import type { QuestionContent } from './question-service';

// ===== AI 动态出题 =====

const DIMENSION_DESCRIPTIONS: Record<AbilityDimension, string> = {
  thinking: '逻辑分析、问题拆解、批判性思考、识别逻辑谬误',
  creativity: '创新思维、发散思考、方案设计、从不同角度看问题',
  execution: '行动力、效率、完成度、把想法变成现实',
  learning: '学习速度、知识整合、举一反三、总结归纳',
  communication: '表达清晰、协作、说服力、共情能力',
  resilience: '抗压、坚持、从失败中恢复、适应变化',
};

export async function generateQuestions(
  dimension: AbilityDimension,
  difficulty: string,
  count: number,
): Promise<QuestionContent[]> {
  const models = await getAllModels();
  if (models.length === 0) return [];
  const model = models[0];

  const desc = DIMENSION_DESCRIPTIONS[dimension];
  const prompt = buildPrompt(dimension, desc, difficulty, count);

  try {
    const provider = getProviderClientForModel(model);
    if (!provider) return [];
    const result = await streamText({
      model: provider(model.id),
      prompt,
      temperature: 0.8,
      maxOutputTokens: 4096,
    });
    const text = await result.text;
    return parseQuestions(text);
  } catch {
    return [];
  }
}

function buildPrompt(
  dimension: AbilityDimension,
  desc: string,
  difficulty: string,
  count: number,
): string {
  return `你是一个专业的出题专家。请为「${dimension}」维度生成 ${count} 道 ${difficulty} 难度的题目。

维度定义：${desc}

题型可以是：
- choice（选择题，4 个选项，答案是 A/B/C/D 之一）
- judge（判断题，答案是 "对" 或 "错"）
- scenario（场景题，给出一个场景让用户分析，答案是 A/B/C/D 之一）

请返回纯 JSON 数组，不要包含其他文字。每道题格式：
{
  "stem": "题目内容",
  "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
  "answer": "A",
  "explanation": "解析说明"
}

judge 类型的 options 为 ["对", "错"]。
scenario 类型需要描述一个真实场景，让用户选择最佳做法。

要求：
- 题目内容要贴近日常生活和工作场景
- 避免过于专业或晦涩的知识
- 解析要简洁明了，帮助理解正确答案

返回 [${count}] 道题的 JSON 数组：`;
}

function parseQuestions(text: string): QuestionContent[] {
  const cleaned = text
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const arr = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return [];
    return arr.filter(isValidQuestion).map(normalizeQuestion);
  } catch {
    return [];
  }
}

function isValidQuestion(q: unknown): q is Record<string, unknown> {
  if (typeof q !== 'object' || q === null) return false;
  const obj = q as Record<string, unknown>;
  return (
    typeof obj.stem === 'string' &&
    typeof obj.answer === 'string' &&
    typeof obj.explanation === 'string' &&
    (obj.options === undefined || Array.isArray(obj.options))
  );
}

function normalizeQuestion(q: Record<string, unknown>): QuestionContent {
  const options = Array.isArray(q.options) ? q.options.map(String) : undefined;
  return {
    stem: String(q.stem).trim(),
    options,
    answer: String(q.answer).trim().toUpperCase(),
    explanation: String(q.explanation).trim(),
  };
}

async function getFirstModel() {
  try {
    const models = await getAllModels();
    return models[0] ?? null;
  } catch {
    return null;
  }
}
