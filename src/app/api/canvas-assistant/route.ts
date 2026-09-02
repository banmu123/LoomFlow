import { NextRequest } from 'next/server';
import { streamText } from 'ai';
import type { ModelMessage } from 'ai';
import { getCurrentUser } from '@/lib/server-auth';
import { getProviderClientForModel } from '@/lib/ai';
import { getAllModels } from '@/lib/ai/db-models';
import { buildRunsSummaryText } from '@/lib/flow-runs-summary';
import { listWorkflowNotes, notesToPromptText } from '@/lib/workflow-notes';

export const runtime = 'nodejs';

// ===== 画布 AI 助手 =====
// 在画布编辑器内协助用户分析/修改当前工作流：
// - 前端把画布数据（nodes/edges）随消息发送，注入系统提示作为上下文
// - AI 可输出 ```json 工作流 JSON（前端解析后提供「应用修改」）
// - 无持久化（会话在客户端组件内存中）

const MAX_CANVAS_CHARS = 6000;

/** 画布数据 → 注入提示词的摘要（超长截断，防 token 爆炸） */
export function summarizeCanvas(canvasData: unknown): string {
  if (canvasData === null || canvasData === undefined) return '（无数据）';
  try {
    const raw = JSON.stringify(canvasData);
    if (!raw) return '（无数据）';
    return raw.length > MAX_CANVAS_CHARS ? `${raw.slice(0, MAX_CANVAS_CHARS)}…（已截断）` : raw;
  } catch {
    return '（无法序列化）';
  }
}

const SYSTEM_PROMPT = `你是 LoomFlow 画布中的 AI 工作流助手，协助用户查看、分析和修改当前画布上的工作流。

## 当前工作流数据（JSON：nodes / edges / viewport）

\`\`\`json
{cCanvas}
\`\`\`

## 规则

1. **节点类型**（type 字段）：startNode 开始、endNode 结束、llmNode 大模型、httpNode HTTP 请求、codeNode 动态代码、knowledgeNode 知识库、searchEngineNode 网络搜索、templateNode 模板、conditionNode 条件、confirmNode 人工确认、loopNode 循环、excelNode Excel 导出
2. **修改工作流**：当用户要求修改时，输出修改后的**完整工作流 JSON**（包含全部 nodes/edges/viewport，与上面格式一致），放在 \`\`\`json 代码块中，并在代码块外简要说明改了什么
3. 只改用户要求的部分：保持已有节点 id 不变；新增节点用新的 id（如 node_ai_1）；删除/合并节点时同步修正 edges 引用
4. **配置字段**：llmNode 用 llmId（模型 ID）/systemPrompt/userPrompt/temperature；searchEngineNode 用 engine（搜索服务名）/keyword/limit；excelNode 用 sheetName/fileName/outputType（数据来自上游 parameters）
5. 用户只提问不要求修改时，直接分析回答（结构、问题、优化建议），不要输出 JSON
6. 回复使用用户的语言

## 最近运行记录（Debug 数据源）

{cRuns}

## 工作流笔记（Brew Notes）

{cNotes}

## Debug 分析规则

当用户问"为什么失败/报错/超时/排查"等调试问题时：
1. **优先依据上面的运行记录**分析：失败节点、耗时（卡住=耗时长的节点）、具体错误信息
2. 指出失败原因 + 给出可执行的修复建议（如"检查搜索服务连接测试""模型配置是否正确"）
3. 如果记录里有多次失败，指出失败频率/趋势（如"最近 5 次运行中该节点 4 次失败"）
4. 运行记录不完整时如实说明，不要编造

## 笔记引用规则

用户问"为什么这样设计/为什么选 X/当时怎么想的"等设计问题时，优先依据上面的工作流笔记回答（如 "According to your notes, Exa was chosen because..."）；笔记中没有时如实说明"笔记中没有记录"。`;

/** 组装系统提示词（画布数据 + 最近运行摘要 + 工作流笔记注入） */
export async function buildSystemPrompt(
  canvasData: unknown,
  runsSummary: string,
  notesText: string,
): Promise<string> {
  return SYSTEM_PROMPT
    .replace('{cCanvas}', summarizeCanvas(canvasData))
    .replace('{cRuns}', runsSummary)
    .replace('{cNotes}', notesText);
}

/**
 * UIMessage → 纯文本。
 * 前端 useChat 发送的是 UIMessage 结构（内容在 parts 数组的 text 分片中），
 * 不能只读 content 字段，否则提取结果为空、streamText 抛 "messages must not be empty"。
 */
export function extractMessageText(m: { role?: unknown; parts?: unknown; content?: unknown }): string {
  if (Array.isArray(m.parts)) {
    return m.parts
      .map((p) =>
        p && typeof p === 'object' && (p as { type?: string }).type === 'text'
          ? String((p as { text?: unknown }).text ?? '')
          : '',
      )
      .join('');
  }
  if (Array.isArray(m.content)) {
    return (m.content as Array<{ type?: string; text?: string }>)
      .filter((p) => p.type === 'text')
      .map((p) => p.text ?? '')
      .join('');
  }
  return String(m.content ?? '');
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const rawMessages = body?.messages as
    | Array<{ role: string; content?: unknown; parts?: unknown }>
    | undefined;
  const canvasData = body?.canvasData;
  const images = Array.isArray(body?.images) ? (body.images as string[]) : [];
  const requestedModel = body?.model as string | undefined;
  const workflowId = body?.workflowId as string | null | undefined;

  if (!rawMessages || !Array.isArray(rawMessages) || rawMessages.length === 0) {
    return Response.json({ error: 'messages 参数缺失' }, { status: 400 });
  }

  const allModels = await getAllModels();
  if (allModels.length === 0) {
    return Response.json(
      { error: '尚未配置模型，请先在「模型配置」中添加（管理后台 → 模型配置）' },
      { status: 400 },
    );
  }
  const modelId =
    requestedModel && allModels.some((m) => m.id === requestedModel)
      ? requestedModel
      : allModels[0].id;
  const activeModel = allModels.find((m) => m.id === modelId);
  if (!activeModel) {
    return Response.json({ error: `未知模型: ${modelId}` }, { status: 400 });
  }
  const provider = getProviderClientForModel(activeModel);
  if (!provider) {
    return Response.json({ error: `未知 provider: ${activeModel.provider}` }, { status: 500 });
  }

  // 前端 useChat 发送 UIMessage 结构（含 parts）：extractMessageText 兼容 parts / content 两种结构
  const promptMessages: ModelMessage[] = rawMessages
    .slice(-12)
    .map((m) => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: extractMessageText(m),
    }))
    .filter((m) => m.content.trim().length > 0);

  if (promptMessages.length === 0) {
    return Response.json({ error: '消息内容为空' }, { status: 400 });
  }

  // 多模态：最后一条用户消息附带图片（仅视觉模型；deepseek 等非视觉模型忽略）
  const supportsVision =
    Array.isArray(activeModel.capabilities) && activeModel.capabilities.includes('vision');
  if (supportsVision && images.length > 0 && promptMessages.length > 0) {
    const last = promptMessages[promptMessages.length - 1];
    if (last.role === 'user') {
      promptMessages[promptMessages.length - 1] = {
        role: 'user',
        content: [
          { type: 'text', text: String(last.content) },
          ...images.map((url) => ({ type: 'image' as const, image: url })),
        ],
      };
    }
  }

  const result = streamText({
    model: provider(modelId),
    // Debug Assistant + Brew Notes：注入最近运行摘要与工作流笔记
    system: await buildSystemPrompt(
      canvasData,
      await buildRunsSummaryText(user.id, workflowId, 5),
      workflowId
        ? notesToPromptText(await listWorkflowNotes(workflowId, user.id))
        : '（未保存的工作流，无笔记）',
    ),
    messages: promptMessages,
    temperature: 0.6,
    maxOutputTokens: 4096,
  });

  // 与 /api/chat-ai 一致：发送 reasoning（思考过程在 UI 折叠展示）
  return result.toUIMessageStreamResponse({
    sendReasoning: true,
  });
}
