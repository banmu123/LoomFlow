import { NextRequest } from 'next/server';
import { streamText } from 'ai';
import { getCurrentUser } from '@/lib/server-auth';
import { getProviderClientForModel } from '@/lib/ai';
import { getAllModels } from '@/lib/ai/db-models';
import { uiStreamErrorText } from '@/lib/ai/ui-stream-error';
import { listWorkflowNotes, ensureWorkflowOwnership, notesToPromptText } from '@/lib/workflow-notes';
import { buildRunsSummaryText } from '@/lib/flow-runs-summary';

export const runtime = 'nodejs';

// ===== Brew Notes AI 能力 =====
// POST /api/workflow-notes/ai-summary：AI 总结全部笔记（purpose/decisions/issues/optimizations）
// POST /api/workflow-notes/ai-suggest：AI 基于笔记 + 最近运行建议新笔记（只返回内容，不自动写入）

async function getModelClient() {
  const allModels = await getAllModels();
  if (allModels.length === 0) {
    return { error: '尚未配置模型，请先在「模型配置」中添加' };
  }
  const model = allModels[0];
  const provider = getProviderClientForModel(model);
  if (!provider) return { error: `未知 provider: ${model.provider}` };
  return { model, provider };
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const workflowId = (body?.workflowId || '').trim();
  if (!workflowId) {
    return Response.json({ error: '缺少 workflowId' }, { status: 400 });
  }

  const ownership = await ensureWorkflowOwnership(workflowId, user.id);
  if (!ownership.ok) {
    return Response.json({ error: ownership.error }, { status: 403 });
  }

  const notes = await listWorkflowNotes(workflowId, user.id);
  const runsSummary = await buildRunsSummaryText(user.id, workflowId, 5);
  const notesText = notesToPromptText(notes);

  const client = await getModelClient();
  if ('error' in client) {
    return Response.json({ error: client.error }, { status: 400 });
  }

  const isSummary = request.nextUrl.pathname.endsWith('/ai-summary');
  const system = isSummary
    ? `你是 LoomFlow 的工作流笔记总结助手。请把用户提供的笔记整理为结构化总结（Markdown）：
## Workflow Purpose（用途）
## Design Decisions（设计决策）
## Known Issues（已知问题）
## Optimization History（优化记录）
没有对应内容时写「（无）」。使用简洁中文。`
    : `你是 LoomFlow 的工作流笔记建议助手。根据工作流的设计笔记与最近运行记录，指出值得记录的新笔记（如发现的问题/优化建议/设计意图），返回 0-3 条建议，每条格式：
- [类型: decision/problem/solution/optimization/usage] 内容
没有建议时返回「（暂无建议）」。只返回建议列表，不要添加其他说明。使用简洁中文。`;

  const prompt = isSummary
    ? `工作流设计笔记：\n${notesText || '（无笔记）'}`
    : `工作流设计笔记：\n${notesText || '（无笔记）'}\n\n最近运行记录：\n${runsSummary}`;

  const result = streamText({
    model: client.provider(client.model.id),
    system,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.4,
    maxOutputTokens: 2048,
  });

  // onError：SDK 默认把真实错误脱敏为 "An error occurred."，透传可诊断文案
  return result.toUIMessageStreamResponse({ sendReasoning: false, onError: uiStreamErrorText });
}
