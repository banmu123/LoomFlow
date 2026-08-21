import { streamText } from 'ai';
import { getProviderClientForModel } from '@/lib/ai/providers';
import { getAllModels } from '@/lib/ai/db-models';

// ===== AI 自评问卷生成 =====

export interface AssessmentQuestion {
  id: string;
  stem: string;
  type: 'single' | 'multi';
  options: Array<{ id: string; text: string }>;
}

export interface AssessmentAnswer {
  questionId: string;
  selectedOptionIds: string[];
}

/** AI 生成 15 道自评题目 */
export async function generateAssessmentQuestions(modelId?: string): Promise<AssessmentQuestion[]> {
  const models = await getAllModels();
  if (models.length === 0) return [];
  const model = modelId ? models.find((m) => m.id === modelId) ?? models[0] : models[0];

  const prompt = `你是一个专业的测评设计专家。请生成 15 道自我评估题目。

要求：
1. 题目应该覆盖：思维方式、创造力、行动力、学习能力、沟通协作、抗压韧性
2. 不要直接问"你的XX能力如何"，而是通过场景和偏好来间接反映
3. 题型混合：部分单选、部分多选（多选题需要说明"可多选"）
4. 选项不要有明显的优劣之分，每个选项都有其价值
5. 不要在题目中暗示测的是什么能力
6. 题目要贴近日常生活和工作场景

请返回纯 JSON 数组，每道题格式：
{
  "stem": "题目内容",
  "type": "single 或 multi",
  "options": [
    { "id": "a", "text": "选项内容" },
    { "id": "b", "text": "选项内容" },
    { "id": "c", "text": "选项内容" },
    { "id": "d", "text": "选项内容" }
  ]
}

示例单选题：
{
  "stem": "周末你更倾向于？",
  "type": "single",
  "options": [
    { "id": "a", "text": "探索一个从没去过的地方" },
    { "id": "b", "text": "在家看书或学点新东西" },
    { "id": "c", "text": "约朋友聚会聊天" },
    { "id": "d", "text": "完成搁置已久的计划" }
  ]
}

示例多选题：
{
  "stem": "以下哪些描述更像你？（可多选）",
  "type": "multi",
  "options": [
    { "id": "a", "text": "喜欢把事情安排得井井有条" },
    { "id": "b", "text": "经常冒出新奇的想法" },
    { "id": "c", "text": "遇到困难不容易放弃" },
    { "id": "d", "text": "善于倾听别人的想法" }
  ]
}

请生成 15 道题：`;

  try {
    const provider = getProviderClientForModel(model);
    if (!provider) {
      console.error('[ai-assessment] No provider for model:', model);
      return [];
    }
    console.log('[ai-assessment] Generating questions with model:', model.id, 'baseURL:', model.baseURL, 'hasKey:', !!model.apiKey);
    const result = await streamText({
      model: provider(model.id),
      prompt,
      temperature: 0.8,
      maxOutputTokens: 6000,
    });
    const text = await result.text;
    console.log('[ai-assessment] Generated text length:', text.length);
    return parseQuestions(text);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[ai-assessment] Error generating questions:', errMsg);
    // 抛出错误让调用方看到具体原因
    throw new Error(`AI 调用失败: ${errMsg}`);
  }
}

function parseQuestions(text: string): AssessmentQuestion[] {
  const cleaned = text
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const arr = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return [];
    return arr.filter(isValidQuestion).map((q, i) => normalizeQuestion(q, i));
  } catch {
    return [];
  }
}

function isValidQuestion(q: unknown): q is Record<string, unknown> {
  if (typeof q !== 'object' || q === null) return false;
  const obj = q as Record<string, unknown>;
  if (typeof obj.stem !== 'string' || !obj.stem.trim()) return false;
  if (!Array.isArray(obj.options) || obj.options.length < 2) return false;
  return true;
}

function normalizeQuestion(q: Record<string, unknown>, index: number): AssessmentQuestion {
  const type = q.type === 'multi' ? 'multi' : 'single';
  const options = (q.options as Array<{ id?: string; text?: string }>).map((opt, j) => ({
    id: opt.id || String.fromCharCode(97 + j),
    text: String(opt.text || ''),
  }));
  return {
    id: `q_${index}`,
    stem: String(q.stem).trim(),
    type,
    options,
  };
}

/** AI 分析自评结果，返回六维分数 */
export async function analyzeAssessmentResults(
  questions: AssessmentQuestion[],
  answers: AssessmentAnswer[],
  modelId?: string,
): Promise<{ scores: Record<string, number>; analysis: string; recommendedCareers: string[] } | null> {
  const models = await getAllModels();
  if (models.length === 0) return null;
  const model = modelId ? models.find((m) => m.id === modelId) ?? models[0] : models[0];

  const answerSummary = questions.map((q) => {
    const answer = answers.find((a) => a.questionId === q.id);
    const selectedTexts = (answer?.selectedOptionIds ?? [])
      .map((optId) => q.options.find((o) => o.id === optId)?.text)
      .filter(Boolean);
    return `题目：${q.stem}\n选择：${selectedTexts.join('、') || '未作答'}`;
  }).join('\n\n');

  const prompt = `你是一个专业的个人能力评估分析师和职业规划顾问。以下是一个用户的自评问卷回答，请分析其能力特征并推荐适合的职业方向。

${answerSummary}

请根据用户的回答，评估以下 6 个维度的能力值（0-100）：
- thinking（思维力）：逻辑分析、问题拆解、批判性思考
- creativity（创造力）：创新思维、发散思考、方案设计
- execution（行动力）：行动力、效率、完成度
- learning（学习力）：学习速度、知识整合、举一反三
- communication（连接力）：表达清晰、协作、说服力
- resilience（韧性）：抗压、坚持、从失败中恢复

注意：
1. 不要所有维度都给 50-70 的中间分，要有区分度
2. 基于用户的选择模式来判断，不要猜测
3. 给出简短的分析说明（2-3 句话概括用户的特点）
4. 根据用户的能力特征，推荐 3-5 个最适合的职业方向

请返回纯 JSON：
{
  "scores": {
    "thinking": 75,
    "creativity": 60,
    "execution": 85,
    "learning": 70,
    "communication": 55,
    "resilience": 80
  },
  "analysis": "你是一个行动力很强的人，善于分析问题并快速采取行动。在创造力方面还有提升空间，可以尝试更多发散性思考。",
  "recommendedCareers": ["产品经理", "项目经理", "运营总监"]
}`;

  try {
    const provider = getProviderClientForModel(model);
    if (!provider) return null;
    const result = await streamText({
      model: provider(model.id),
      prompt,
      temperature: 0.5,
      maxOutputTokens: 1500,
    });
    const text = await result.text;
    return parseAnalysis(text);
  } catch {
    return null;
  }
}

function parseAnalysis(text: string): { scores: Record<string, number>; analysis: string; recommendedCareers: string[] } | null {
  const cleaned = text
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]);
    if (typeof obj !== 'object' || obj === null) return null;
    if (typeof obj.scores !== 'object' || typeof obj.analysis !== 'string') return null;

    const validDimensions = ['thinking', 'creativity', 'execution', 'learning', 'communication', 'resilience'];
    const scores: Record<string, number> = {};
    for (const dim of validDimensions) {
      const val = obj.scores[dim];
      scores[dim] = typeof val === 'number' ? Math.max(0, Math.min(100, Math.round(val))) : 50;
    }

    const recommendedCareers = Array.isArray(obj.recommendedCareers)
      ? obj.recommendedCareers.filter((c: unknown) => typeof c === 'string' && c.trim()).map((c: string) => c.trim())
      : [];

    return { scores, analysis: obj.analysis.trim(), recommendedCareers };
  } catch {
    return null;
  }
}
