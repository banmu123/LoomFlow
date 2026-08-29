import { streamText, isStepCount } from 'ai';
import type { ModelMessage } from 'ai';
import { buildSystemPrompt } from '@/lib/workflow-ai/prompts';
import { getProviderClientForModel, hasCapability } from '@/lib/ai';
import { getAllModels } from '@/lib/ai/db-models';
import { getEnabledSearchProviders } from '@/lib/search/db-providers';
import { agentTools, agentToolsPrompt, systemNavPrompt } from '@/lib/agent/tools';
import { detectIntentFromMessages } from '@/lib/agent/intent';
import { supabase } from '@/lib/supabase/server';
import { getAbilityScores } from '@/lib/growth/ability-service';
import { analyzeConversationTrends } from '@/lib/growth/conversation-trends';
import { analyzeBehaviorInsights, behaviorInsightToText } from '@/lib/growth/behavior-insights';
import type { AbilityScores } from '@/lib/growth/ability-types';

// ===== 后台生成执行器 =====
// 生成任务生命周期属于 conversation（数据库消息状态），不依赖客户端连接：
// 前端只负责"发送请求 + 轮询观察"，页面刷新/卸载不会中断生成。
// 状态流转（数据库 messages.status）：pending → streaming → done / error / cancelled

const MAX_MESSAGES = 20;

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

// 完整系统提示词（对话规则 + 工作流生成规则 + 用户画像 + 对话趋势）
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

export interface ToolLog {
  toolName: string;
  status: 'running' | 'done' | 'error';
}

// 正在执行的后台生成任务（assistantMessageId → 防重复触发）
// 注意：Next.js route handler 中 fire-and-forget 在部分生产环境可能不执行，
// 因此生成由「发消息端点触发 + 轮询端点兜底触发」双保险驱动
const runningTasks = new Set<string>();

/**
 * 幂等触发生成：同一 assistant 消息只启动一次执行器。
 * 无论由发消息端点还是轮询端点调用，都不会重复执行。
 */
export function ensureGeneration(opts: {
  conversationId: string;
  assistantMessageId: string;
  model?: string;
  images?: string[];
}): void {
  const key = opts.assistantMessageId;
  if (runningTasks.has(key)) return;
  runningTasks.add(key);
  void runAiGeneration(opts).finally(() => {
    runningTasks.delete(key);
  });
}

// 写数据库（后台任务专用；service role client 无请求上下文依赖）
async function patchMessage(
  messageId: string,
  patch: {
    content?: string;
    reasoning?: string | null;
    status?: string;
    error?: string | null;
    tool_logs?: ToolLog[] | null;
  },
) {
  try {
    await supabase.from('messages').update(patch).eq('id', messageId);
  } catch {
    // 写库失败不阻断生成（下次写入重试）
  }
}

async function readMessageStatus(messageId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('messages')
      .select('status')
      .eq('id', messageId)
      .single();
    return data?.status ?? null;
  } catch {
    return null;
  }
}

/**
 * 后台生成：读对话历史 → 调用 AI（streamText）→ 边生成边写库（节流）→ 完成落库。
 * 每次写库前检查 DB 状态：cancelled（用户主动停止）→ 保存已生成内容后退出。
 */
export async function runAiGeneration(opts: {
  conversationId: string;
  assistantMessageId: string;
  /** 用户选中的模型（不存在时用第一个配置的模型） */
  model?: string;
  /** 图片（多模态，仅视觉模型支持） */
  images?: string[];
}): Promise<void> {
  const { conversationId, assistantMessageId, images = [] } = opts;
  const modelParam = opts.model;

  // 节流写入：累积到阈值或超时后写一次（轮询 500ms，写太频繁无意义）
  const WRITE_INTERVAL_MS = 300;
  let lastWriteAt = 0;
  let contentBuf = '';
  let content = '';
  let reasoning = '';
  const toolLogs: ToolLog[] = [];

  const flush = async (finalStatus?: 'done' | 'error' | 'cancelled', errorMsg?: string) => {
    if (contentBuf || finalStatus) {
      await patchMessage(assistantMessageId, {
        content,
        reasoning: reasoning || null,
        status: finalStatus ?? 'streaming',
        error: errorMsg ?? null,
        tool_logs: toolLogs.length > 0 ? toolLogs : null,
      });
      contentBuf = '';
      lastWriteAt = Date.now();
    }
  };

  try {
    // ===== 1. 读对话历史（不含当前 pending 的 assistant 消息）=====
    const [historyRes, convRes] = await Promise.all([
      supabase
        .from('messages')
        .select('id, role, content, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true }),
      supabase
        .from('conversations')
        .select('user_id')
        .eq('id', conversationId)
        .single(),
    ]);
    const history = historyRes.data;
    const userId = convRes.data?.user_id;
    const dbHistory = (history ?? []).filter(
      (m: { id: string }) => m.id !== assistantMessageId,
    );
    const chatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = dbHistory
      .slice(-MAX_MESSAGES)
      .map((m: { role: 'user' | 'assistant'; content: string }) => ({
        role: m.role,
        content: m.content,
      }));

    if (chatHistory.length === 0) {
      await flush('error', '没有可生成的消息上下文');
      return;
    }

    // ===== 2. 模型校验与选择 =====
    const allModels = await getAllModels();
    if (allModels.length === 0) {
      await flush('error', '尚未配置模型，请先在「模型配置」中添加');
      return;
    }
    const requestedModel =
      modelParam && allModels.some((m) => m.id === modelParam)
        ? modelParam
        : allModels[0].id;
    const activeModel = allModels.find((m) => m.id === requestedModel);
    if (!activeModel) {
      await flush('error', `未知模型: ${requestedModel}`);
      return;
    }
    const provider = getProviderClientForModel(activeModel);
    if (!provider) {
      await flush('error', `未知 provider: ${activeModel.provider}`);
      return;
    }

    // ===== 3. 构建消息（支持图片多模态）=====
    const promptMessages: ModelMessage[] = chatHistory.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    if (hasCapability(activeModel, 'vision') && images.length > 0 && promptMessages.length > 0) {
      const last = promptMessages[promptMessages.length - 1];
      promptMessages[promptMessages.length - 1] = {
        role: 'user',
        content: [
          { type: 'text', text: String(last.content) },
          ...images.map((url) => ({ type: 'image' as const, image: url })),
        ],
      };
    }

    // ===== 4. 意图分流 + 系统提示词 =====
    const intent = detectIntentFromMessages(chatHistory);
    const useTools = intent === 'query';
    const searchProviders = (await getEnabledSearchProviders()).map((s) => ({
      id: s.id,
      label: s.label,
    }));

    // 获取用户画像 + 对话趋势 + 行为洞察
    const [abilityProfile, trend, behaviorInsight] = userId
      ? await Promise.all([
          getAbilityScores(userId),
          analyzeConversationTrends(userId),
          analyzeBehaviorInsights(userId),
        ])
      : [null, null, null];
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
      trend ?? undefined,
      behaviorText,
    );

    // ===== 5. 流式生成（后台执行，边生成边写库）=====
    const result = streamText({
      model: provider(requestedModel),
      system: `${systemPrompt}

---

${systemNavPrompt}
${useTools ? `\n\n${agentToolsPrompt}` : ''}`,
      messages: promptMessages,
      temperature: 0.7,
      maxOutputTokens: 8192,
      tools: useTools ? agentTools : undefined,
      toolChoice: useTools ? 'auto' : 'none',
      stopWhen: isStepCount(10),
    });

    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        content += part.text;
        contentBuf += part.text;
      } else if (part.type === 'reasoning-delta') {
        reasoning += part.text;
      } else if (part.type === 'tool-call') {
        toolLogs.push({
          toolName: (part as { toolName: string }).toolName,
          status: 'running',
        });
      } else if (part.type === 'tool-result') {
        const toolName = (part as { toolName: string }).toolName;
        const output = (part as { output?: { error?: string } }).output;
        const idx = toolLogs.findIndex((l) => l.toolName === toolName);
        if (idx >= 0) {
          toolLogs[idx] = { ...toolLogs[idx], status: output?.error ? 'error' : 'done' };
        }
      } else if (part.type === 'error') {
        const errMsg =
          (part as { error?: { message?: string } }).error?.message || '生成失败';
        await flush('error', errMsg);
        return;
      }

      // 节流写库（流式进度落库，前端轮询可见）
      const now = Date.now();
      if (contentBuf && now - lastWriteAt >= WRITE_INTERVAL_MS) {
        await flush();
        // 写库后检查：用户是否已主动停止
        if ((await readMessageStatus(assistantMessageId)) === 'cancelled') {
          await flush('cancelled');
          return;
        }
      }
    }

    // 最终检查停止状态（最后一次写入后可能被取消）
    const finalStatus = await readMessageStatus(assistantMessageId);
    if (finalStatus === 'cancelled') {
      await flush('cancelled');
      return;
    }
    await flush('done');
  } catch (err) {
    const msg = err instanceof Error ? err.message : '生成失败';
    await patchMessage(assistantMessageId, {
      content,
      reasoning: reasoning || null,
      status: 'error',
      error: msg,
      tool_logs: toolLogs.length > 0 ? toolLogs : null,
    });
  }
}
