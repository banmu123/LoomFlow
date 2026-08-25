import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { getCurrentUser } from '@/lib/server-auth';
import { getProviderClientForModel } from '@/lib/ai';
import { getAllModels } from '@/lib/ai/db-models';
import { supabase } from '@/lib/supabase/server';
import { listWorkflowNotes, notesToPromptText } from '@/lib/workflow-notes';
import { buildCopilotContext, contextToPrompt, type CopilotTask } from '@/lib/workflow-copilot/context';
import { buildProposal } from '@/lib/workflow-copilot/proposal';
import { diffToMarkdown } from '@/lib/workflow-copilot/diff';
import type { PatchOperation } from '@/lib/workflow-copilot/patch';
import type { EvaluationRule } from '@/lib/workflow-copilot/evaluation';
import { ensureWorkflowOwnership, listTestCases } from '@/lib/workflow-copilot/test-case-store';
import type { TinyflowData } from '@/lib/tinyflow/types';

export const runtime = 'nodejs';

const TASKS = new Set<CopilotTask>(['create', 'modify', 'debug', 'explain', 'optimize', 'test']);

function normalizeTask(raw: string): CopilotTask {
  const t = raw?.toLowerCase() as CopilotTask;
  return TASKS.has(t) ? t : 'modify';
}

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

interface TestCaseDraft {
  name: string;
  description?: string;
  inputs: Record<string, unknown>;
  evaluationRules: EvaluationRule[];
}

async function loadWorkflow(workflowId: string, userId: string): Promise<{ data: TinyflowData; error?: string }> {
  const own = await ensureWorkflowOwnership(workflowId, userId);
  if (!own.ok) return { data: {} as TinyflowData, error: own.error };
  const { data } = await supabase.from('workflow_history').select('data').eq('id', workflowId).maybeSingle();
  return { data: (data?.data ?? {}) as TinyflowData };
}

async function loadRecentRuns(workflowId: string, userId: string) {
  const { data } = await supabase
    .from('flow_runs')
    .select('status, error, trace, created_at')
    .eq('workflow_id', workflowId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5);
  return data ?? [];
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const task = normalizeTask(body?.task);
  const workflowId = body?.workflowId as string | undefined;
  const userRequest = String(body?.message || body?.request || '').trim();
  if (!userRequest) return NextResponse.json({ error: '请提供请求内容' }, { status: 400 });

  const allModels = await getAllModels();
  if (allModels.length === 0) {
    return NextResponse.json({ error: '尚未配置模型，请先在「模型配置」中添加' }, { status: 400 });
  }
  const modelId = allModels[0].id;
  const activeModel = allModels.find((m) => m.id === modelId);
  if (!activeModel) return NextResponse.json({ error: '未知模型' }, { status: 400 });
  const provider = getProviderClientForModel(activeModel);
  if (!provider) return NextResponse.json({ error: `未知 provider: ${activeModel.provider}` }, { status: 500 });

  // ===== 加载上下文（按任务裁剪） =====
  let workflowData: TinyflowData | null = null;
  if (workflowId) {
    const res = await loadWorkflow(workflowId, user.id);
    if (!res.error) workflowData = res.data;
  }
  const [recentRuns, notes, tests] = await Promise.all([
    workflowId ? loadRecentRuns(workflowId, user.id) : [],
    workflowId ? listWorkflowNotes(workflowId, user.id) : [],
    workflowId ? listTestCases(workflowId, user.id) : [],
  ]);

  const ctx = buildCopilotContext(task, workflowId, {
    workflow: workflowData ?? undefined,
    version: body.version,
    recentRuns,
    notes: notesToPromptText(notes ?? []),
    tests: tests as never[],
  });

  // ===== 任务专用提示词 =====
  const taskInstruction = getTaskInstruction(task);
  const taskPrompt = buildTaskPrompt(task, ctx, userRequest, workflowData);

  let result;
  try {
    result = await generateText({
      model: provider(modelId),
      system: SYSTEM_SYSTEM,
      prompt: taskPrompt,
      temperature: 0.3,
      maxOutputTokens: 4096,
    });
  } catch (err) {
    return NextResponse.json({ error: `AI 调用失败: ${(err as Error).message}` }, { status: 500 });
  }

  const rawText = result.text;

  // ===== 结构化结果 + 校验 =====
  switch (task) {
    case 'test': {
      const parsed = extractJSON<{ testCases: TestCaseDraft[]; explain?: string }>(rawText);
      const testCases = (parsed?.testCases ?? []).filter((tc) => tc.name && tc.inputs);
      return NextResponse.json({
        kind: 'test_cases',
        generated: testCases,
        explain: parsed?.explain,
        note: '此为 AI 生成草稿，请审阅后可保存为正式测试用例',
      });
    }
    case 'debug': {
      const parsed = extractJSON<{
        rootCause: string;
        evidence: string[];
        suggestedFix: string;
        risk: string;
        operations?: PatchOperation[];
      }>(rawText);
      const analysis = { rootCause: parsed?.rootCause, evidence: parsed?.evidence, suggestedFix: parsed?.suggestedFix, risk: parsed?.risk };
      let proposal = null;
      if (workflowData && Array.isArray(parsed?.operations) && parsed.operations.length > 0) {
        proposal = await buildProposal(workflowData, parsed.operations, {
          workflowId: workflowId!,
          fromVersion: body.version,
          tests,
          runTests: true,
          description: parsed?.suggestedFix,
        });
      }
      return NextResponse.json({ kind: 'debug', analysis, proposal, rawText });
    }
    default: {
      // modify / create / optimize / explain：优先解析为 patch operations
      const parsed = extractJSON<{
        explain?: string;
        name?: string;
        operations?: PatchOperation[];
        risk?: string;
      }>(rawText);
      if (workflowData && Array.isArray(parsed?.operations)) {
        const proposal = await buildProposal(workflowData, parsed.operations, {
          workflowId: workflowId!,
          fromVersion: body.version,
          tests,
          runTests: task !== 'explain',
          description: parsed.explain ?? 'AI 修改建议',
        });
        return NextResponse.json({
          kind: 'proposal',
          explanation: parsed.explain,
          risk: parsed.risk,
          proposal,
          markdown: diffToMarkdown(proposal.diff),
          canSave: proposal.schema.valid && !proposal.issues.some((i) => i.level === 'error'),
        });
      }
      // 未产生 patch：返回纯文本分析
      return NextResponse.json({ kind: 'analysis', text: rawText, operations: parsed?.operations ?? [] });
    }
  }
}

function getTaskInstruction(task: CopilotTask): string {
  switch (task) {
    case 'create': return '根据需求创建一个新工作流，输出 operations（以 add_node/connect 为主）。';
    case 'modify': return '基于当前工作流，只做用户要求的修改，输出增量 operations。';
    case 'debug': return '分析失败原因，输出 Root Cause + Evidence + Suggested Fix + Risk + 可选 Patch operations。';
    case 'explain': return '解释当前工作流的结构与设计意图。';
    case 'optimize': return '指出可优化的地方并给出修改 operations（可选）。';
    case 'test': return '生成测试用例清单（normal/boundary/empty/invalid/edge/failure）。';
    default: return '';
  }
}

function buildTaskPrompt(
  task: CopilotTask,
  ctx: ReturnType<typeof buildCopilotContext>,
  userRequest: string,
  workflowData: TinyflowData | null,
): string {
  const contextText = contextToPrompt(ctx);
  const hasWorkflow = !!workflowData;

  const outputSpec =
    task === 'test'
      ? `输出 JSON：{"testCases":[{"name","description","inputs":{...},"evaluationRules":[{"type","path","value"?|"required"?}]}],"explain":"..."}`
      : hasWorkflow
        ? `输出 JSON：{"explain":"...","risk":"...","operations":[{"op":"add_node|remove_node|update_node|move_node|connect|disconnect|replace_node|update_workflow_metadata","node"?|"changes"?|"position"?|"edge"?|"nodeId"?}]}`
        : `输出 JSON：{"operations":[{"op":"add_node",...},{"op":"connect",...}],"name":"...","explain":"..."}`;

  return `用户请求：${userRequest}

${task === 'create' || !hasWorkflow ? '' : contextText}

## 你的任务
${getTaskInstruction(task)}

## 输出格式
严格输出合法 JSON（不要输出 JSON 之外的文字）：
${outputSpec}

## 节点类型
startNode 开始 / endNode 结束 / llmNode 大模型(llmId/systemPrompt/userPrompt) / httpNode 请求(method/url) / codeNode 代码(code) / knowledgeNode 知识库 / searchEngineNode 搜索(engine/keyword/limit) / templateNode 模板(template) / conditionNode 条件(condition) / confirmNode 人工确认 / loopNode 循环 / excelNode Excel

## 规则
1. 修改类操作【只改用户要求的部分】：已知节点 id 保持不变，新增节点用新 id
2. add_node 需要 node.id/node.type 与必要字段；connect 需要 edge.source/target
3. 移除/替换节点时同步处理相关边
4. 不要输出与修改无关的冗余改动
5. ${task === 'test' ? '测试用例需覆盖 normal/boundary/empty/invalid/edge/failure 等类型；evaluationRules.type 用 exact_match|contains|json_path|numeric_tolerance|array_contains|json_schema' : ''}`;
}

const SYSTEM_SYSTEM = `你是 LoomFlow 的 AI Workflow Copilot，能创建、修改、调试和解释工作流。
你的输出必须是结构化 JSON，便于系统校验、对比 Diff、运行测试并由用户批准后生成新版本。
你只能提出修改建议，绝不能绕过 Schema Validation / 依赖校验 / 测试 / 版本控制直接修改。`;
