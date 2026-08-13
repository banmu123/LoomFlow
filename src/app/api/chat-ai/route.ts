import { NextRequest } from 'next/server';
import { streamText } from 'ai';
import type { ModelMessage } from 'ai';
import { buildSystemPrompt } from '@/lib/workflow-ai/prompts';
import { getCurrentUser } from '@/lib/server-auth';

export const runtime = 'nodejs';

// 从 Model Registry（内置 + 用户配置合并）获取模型对应的 provider 客户端
import { getProviderClientForModel, hasCapability } from '@/lib/ai';
import { getAllModels } from '@/lib/ai/db-models';

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

// 系统提示词 - 对话规则部分
const CHAT_RULES = `你是一个AI助手，可以进行正常对话，也可以帮助用户创建工作流。

## 对话规则
1. 如果用户只是打招呼、闲聊、问问题 → 正常对话回复
2. 如果用户明确要求创建工作流、设计流程、实现功能 → 返回工作流 JSON
3. 如果不确定用户意图 → 先询问确认

## 工作流创建时机
只有当用户提到以下关键词时才创建工作流：
- "创建工作流"、"设计工作流"、"做一个工作流"
- "帮我实现"、"帮我做一个"、"设计一个"
- 具体功能描述如"视频生成"、"图片处理"、"搜索总结"等

## 重要
- 正常对话时返回普通文本，不要返回 JSON
- 只有明确要求创建工作流时才返回 JSON
- JSON 要放在 \`\`\`json 代码块中`;

// 完整系统提示词（对话规则 + 工作流生成规则）
// 动态构建：注入当前模型配置列表，防止 AI 幻觉出未配置的模型 id
function buildFullSystemPrompt(
  availableModels: Array<{ id: string; label?: string | null }>,
): string {
  return `${CHAT_RULES}

---

${buildSystemPrompt(availableModels)}`;
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
  const systemPrompt = buildFullSystemPrompt(
    allModels.map((m) => ({ id: m.id, label: m.label })),
  );

  // 使用 streamText 流式调用
  const result = streamText({
    model: provider(modelId),
    system: systemPrompt,
    messages: promptMessages,
    temperature: 0.7,
    maxOutputTokens: 8192,
  });

  // 返回 UI 消息流响应（useChat 需要的格式）
  return result.toUIMessageStreamResponse({
    sendReasoning: true, // 发送推理过程
  });
}
