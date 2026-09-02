import { NextRequest } from 'next/server';
import { streamText, isStepCount } from 'ai';
import type { ModelMessage } from 'ai';
import { buildSystemPrompt } from '@/lib/workflow-ai/prompts';
import { getCurrentUser } from '@/lib/server-auth';
import { getAbilityScores } from '@/lib/growth/ability-service';
import { analyzeConversationTrends } from '@/lib/growth/conversation-trends';
import { analyzeBehaviorInsights, behaviorInsightToText } from '@/lib/growth/behavior-insights';
import type { AbilityScores } from '@/lib/growth/ability-types';

export const runtime = 'nodejs';

// 从 Model Registry（内置 + 用户配置合并）获取模型对应的 provider 客户端
import { getProviderClientForModel, hasCapability } from '@/lib/ai';
import { getAllModels } from '@/lib/ai/db-models';
import { uiStreamErrorText } from '@/lib/ai/ui-stream-error';
// Agent 只读工具集（查询系统状态/排错）+ 系统导航知识
import { agentTools, agentToolsPrompt, systemNavPrompt } from '@/lib/agent/tools';
// 确定性意图预分流（query=查询带工具 / generate=生成不带工具 / chat=闲聊）
import { detectIntentFromMessages } from '@/lib/agent/intent';
import { getEnabledSearchProviders } from '@/lib/search/db-providers';

async function getProviderForModel(modelId: string) {
  const models = await getAllModels();
  const model = models.find((m) => m.id === modelId);
  if (!model) throw new Error(`未知模型: ${modelId}`);
  const client = getProviderClientForModel(model);
  if (!client) throw new Error(`未知 provider: ${model.provider}`);
  return client;
}

const MAX_MESSAGES = 20;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// 系统提示词 - 对话规则部分（人生设计教练：平台即人生，对话即成长）
const CHAT_RULES = `你是 LoomFlow，一个懂用户的 AI 伙伴和人生设计教练。你既可以帮助用户完成具体任务（对话、创建 AI 工作流），也在每一次对话中观察和理解用户，帮助他/她更好地设计自己的人生。

## 核心理念（斯坦福人生设计课方法论）
- 人生不是一道"待解决的题"，而是一个"待设计的产品"
- 你关注用户真正投入、有能量的事情（好时光日志），而不是只看他"擅长"什么
- 你帮用户看到多种可能（奥德赛计划），而不是只给一个答案
- 你鼓励小步尝试（原型实验），而不是等待完美方案
- 你帮用户区分"可以改变的问题"和"需要接受的现实"（重力问题）

## 对话规则
1. 用户打招呼、闲聊、问问题 → 正常对话回复
2. 用户明确要求创建工作流、设计流程、实现功能 → 返回工作流 JSON
3. 你不确定用户意图 → 先询问确认
4. 在自然对话中，如果合适，可以：
   - 留意用户反复提到的话题/困扰 → 帮他看到模式和方向
   - 发现用户对某事有热情时 → 鼓励他探索、给他小实验建议
   - 用户说"不知道该怎么办" → 帮他列出几种可能，而不是替他决定

## 工作流创建时机
只有当用户提到以下关键词时才创建工作流：
- "创建工作流"、"设计工作流"、"做一个工作流"
- "帮我实现"、"帮我做一个"、"设计一个"
- 具体功能描述如"视频生成"、"图片处理"、"搜索总结"等

## 重要
- 正常对话时返回普通文本，不要返回 JSON
- 只有明确要求创建工作流时才返回 JSON
- JSON 要放在 \`\`\`json 代码块中
- 不要过度说教：用户没谈人生方向时，不要硬塞人生建议`;

// 完整系统提示词（对话规则 + 工作流生成规则 + 用户画像 + 对话趋势 + 行为洞察）
// 动态构建：注入当前模型配置列表与搜索服务列表，防止 AI 幻觉出未配置的 id
function buildFullSystemPrompt(
  availableModels: Array<{ id: string; label?: string | null }>,
  availableSearchProviders: Array<{ id: string; label?: string | null }>,
  userProfile?: {
    role: string;
    roleLabel: string;
    scores: AbilityScores;
    recommendedCareers: string[];
  },
  trend?: {
    topics: Array<{ topic: string; count: number }>;
    messageCount: number;
    conversationCount: number;
  },
  behaviorText?: string,
): string {
  let prompt = `${CHAT_RULES}

---

${buildSystemPrompt(availableModels, availableSearchProviders)}`;

  if (userProfile) {
    const dimensionLabels: Record<string, string> = {
      thinking: '思维力',
      creativity: '创造力',
      execution: '行动力',
      learning: '学习力',
      communication: '连接力',
      resilience: '韧性',
    };

    const scoreLines = Object.entries(userProfile.scores)
      .map(([dim, score]) => `  - ${dimensionLabels[dim] || dim}: ${score}/100`)
      .join('\n');

    const careersStr = userProfile.recommendedCareers.length > 0
      ? userProfile.recommendedCareers.join('、')
      : '暂无';

    prompt += `

---

## 用户画像（供你理解用户的参考，不必刻意提起）

用户定位：${userProfile.roleLabel}
能力维度：
${scoreLines}
推荐职业方向：${careersStr}`;
  }

  if (trend && trend.topics.length > 0) {
    const topicLines = trend.topics
      .map((tp) => `  - ${tp.topic}（被提及 ${tp.count} 次）`)
      .join('\n');

    prompt += `

---

## 用户近 30 天对话趋势（最近 ${trend.conversationCount} 段对话、${trend.messageCount} 条消息）

用户反复关注的话题：
${topicLines}

这些是用户真正投入的方向。当对话涉及这些话题时，可以自然地结合用户的历史关注给出更有针对性的回应；如果合适，也可以温和地帮用户看到自己在这些方向上的积累和可能。`;
  }

  if (behaviorText) {
    prompt += `

---

## 用户真实行为（平台记录，供你在适当时机自然引用）

${behaviorText}

这是用户在这个平台上真正做过的事。当用户提到相关工作/困扰时，可以自然引用这些真实行为给出建议（例如"我注意到你上周做了…"），让建议有据可依，而不是泛泛而谈。但不要刻意炫耀数据，保持自然。`;
  }

  return prompt;
}

// 解析响应中的 JSON
function extractJSON(text: string): unknown {
  // 尝试直接解析
  try {
    return JSON.parse(text);
  } catch {
    // 尝试提取 ```json ... ``` 中的内容
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim());
      } catch {
        // ignore
      }
    }
    // 尝试找到第一个 { 和最后一个 }
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

export async function POST(request: NextRequest) {
  // ===== 鉴权 + 配额校验 =====
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  if (user.status !== 'active') {
    return Response.json({ error: '账号已被禁用，请联系管理员' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const messages = body?.messages as ChatMessage[] | undefined;
  const images = (body?.images as string[] | undefined) || [];
  // 模型选择：严格来自模型配置（未配置时给出明确引导；请求的模型不存在时用第一个配置的模型）
  const allModels = await getAllModels();
  if (allModels.length === 0) {
    return Response.json(
      { error: '尚未配置模型，请先在「模型配置」中添加（管理后台 → 模型配置 → 添加模型）' },
      { status: 400 },
    );
  }
  const requestedModel = body?.model as string | undefined;
  const modelId = requestedModel && allModels.some((m) => m.id === requestedModel)
    ? requestedModel
    : allModels[0].id;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: 'messages 参数缺失' }, { status: 400 });
  }

  const lastMessages = messages.slice(-MAX_MESSAGES);

  // 构建消息（支持图片多模态）
  const promptMessages: ModelMessage[] = lastMessages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // 最后一条用户消息附加图片（仅视觉模型支持；DeepSeek 官方 API 不支持，忽略避免挂起）
  const activeModel = allModels.find((m) => m.id === modelId);
  const supportsVision = activeModel ? hasCapability(activeModel, 'vision') : false;
  if (supportsVision && images.length > 0 && promptMessages.length > 0) {
    const last = promptMessages[promptMessages.length - 1];
    promptMessages[promptMessages.length - 1] = {
      role: 'user',
      content: [
        { type: 'text', text: String(last.content) },
        ...images.map((url) => ({ type: 'image' as const, image: url })),
      ],
    };
  }

  const provider = await getProviderForModel(modelId);
  console.log('[chat-ai] Using model:', modelId);

  // 动态注入模型配置列表（防止 AI 生成工作流时幻觉出未配置的模型 id）
  const searchProviders = (await getEnabledSearchProviders()).map((s) => ({
    id: s.id,
    label: s.label,
  }));

  // 获取用户画像 + 对话趋势 + 行为洞察（并行的轻量查询）
  const [abilityProfile, trend, behaviorInsight] = await Promise.all([
    getAbilityScores(user.id),
    analyzeConversationTrends(user.id),
    analyzeBehaviorInsights(user.id),
  ]);
  const userProfile = abilityProfile ? {
    role: abilityProfile.role,
    roleLabel: abilityProfile.roleLabel,
    scores: abilityProfile.scores,
    recommendedCareers: abilityProfile.recommendedCareers,
  } : undefined;

  const behaviorText = behaviorInsight ? behaviorInsightToText(behaviorInsight) : undefined;

  const systemPrompt = buildFullSystemPrompt(
    allModels.map((m) => ({ id: m.id, label: m.label })),
    searchProviders,
    userProfile,
    trend,
    behaviorText,
  );

  // 确定性意图预分流：query=带工具查询/排错；generate、chat=不带工具（杜绝生成时误调工具）
  // 导航知识始终注入（所有模式都能引导用户去正确页面）
  const intent = detectIntentFromMessages(messages);
  const useTools = intent === 'query';

  // 使用 streamText 流式调用
  const result = streamText({
    model: provider(modelId),
    system: `${systemPrompt}

---

${systemNavPrompt}
${useTools ? `\n\n${agentToolsPrompt}` : ''}`,
    messages: promptMessages,
    temperature: 0.7,
    maxOutputTokens: 8192,
    tools: useTools ? agentTools : undefined,
    toolChoice: useTools ? 'auto' : 'none',
    // 关键：AI SDK v7 默认 stopWhen=isStepCount(1)，工具调用后不会继续生成最终回复；
    // 显式允许最多 10 步：LLM 拿到工具结果后继续推理并总结（多工具排错场景也够用）
    stopWhen: isStepCount(10),
  });

  // 返回 UI 消息流响应（useChat 需要的格式）
  // onError：SDK 默认把真实错误脱敏为 "An error occurred."，透传可诊断文案
  return result.toUIMessageStreamResponse({
    sendReasoning: true, // 发送推理过程
    onError: uiStreamErrorText,
  });
}
