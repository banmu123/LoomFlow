import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { getCurrentUser } from '@/lib/server-auth';
import { getProviderClientForModel } from '@/lib/ai';
import { getAllModels } from '@/lib/ai/db-models';
import { supabase } from '@/lib/supabase/server';
import { ensureWorkflowOwnership } from '@/lib/workflow-copilot/test-case-store';
import { getWorkflowEval } from '@/lib/workflow-eval/store';
import { aggregateNodeMetrics } from '@/lib/workflow-eval/metrics';
import { detectBottlenecks } from '@/lib/workflow-eval/bottleneck';
import { analyzeWorkflow } from '@/lib/workflow-eval/static-analysis';
import {
  buildOptimizationContext,
  extractOptimization,
  finalizeOptimization,
  OPTIMIZE_SYSTEM_PROMPT,
} from '@/lib/workflow-eval/ai-optimize';
import { listTestCases } from '@/lib/workflow-copilot/test-case-store';
import type { EvalRange } from '@/lib/workflow-eval/metrics';
import type { TinyflowData } from '@/lib/tinyflow/types';

export const runtime = 'nodejs';

// AI Optimization：metrics+trace+tests+static → AI → patch → 校验管线
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
  const { id } = await params;
  const own = await ensureWorkflowOwnership(id, user.id);
  if (!own.ok) return NextResponse.json({ error: own.error }, { status: 403 });

  const body = await request.json().catch(() => null);
  const range = (body?.range ?? '7d') as EvalRange;
  const flowData = body?.flowData as TinyflowData | undefined;

  // 模型
  const allModels = await getAllModels();
  if (allModels.length === 0) return NextResponse.json({ error: '尚未配置模型' }, { status: 400 });
  const model = allModels[0];
  const provider = getProviderClientForModel(model);
  if (!provider) return NextResponse.json({ error: `未知 provider: ${model.provider}` }, { status: 500 });

  // 读取当前工作流（未传 flowData 时）
  let workflow = flowData ?? null;
  if (!workflow) {
    const { data } = await supabase.from('workflow_history').select('data').eq('id', id).maybeSingle();
    workflow = (data?.data ?? null) as TinyflowData | null;
  }
  if (!workflow?.nodes) return NextResponse.json({ error: '工作流数据为空' }, { status: 400 });

  // 组装评估上下文
  const evalData = await getWorkflowEval(id, user.id, range);
  const nodeResult = aggregateNodeMetrics(evalData.selectedRuns);
  const bottlenecks = detectBottlenecks(evalData.workflow, nodeResult.nodes);
  const staticAnalysis = analyzeWorkflow(workflow);
  const testCases = await listTestCases(id, user.id);

  const contextText = buildOptimizationContext({
    workflow,
    workflowId: id,
    metrics: evalData.workflow,
    nodes: nodeResult.nodes,
    bottlenecks,
    staticAnalysis,
    testCases: testCases.map((tc) => ({ name: tc.name })),
  });

  const prompt = `${contextText}\n\n请根据以上数据输出优化 Patch（JSON）。`;

  let text: string;
  try {
    const result = await generateText({
      model: provider(model.id),
      system: OPTIMIZE_SYSTEM_PROMPT,
      prompt,
      temperature: 0.4,
      maxOutputTokens: 4096,
    });
    text = result.text;
  } catch (err) {
    return NextResponse.json({ error: `AI 调用失败: ${(err as Error).message}` }, { status: 500 });
  }

  const parsed = extractOptimization(text);
  if (!Array.isArray(parsed.operations) || parsed.operations.length === 0) {
    return NextResponse.json(
      { error: 'AI 未生成有效优化方案', rawText: text.slice(0, 400) },
      { status: 422 },
    );
  }

  // 进入 copilot 校验管线（apply 副本 → 校验 → 跑测试 → diff）
  const optimization = await finalizeOptimization(workflow, parsed.operations, {
    workflowId: id,
    testCases: testCases.map((tc) => ({
      id: tc.id,
      workflowId: id,
      workflowVersion: tc.workflowVersion,
      name: tc.name,
      inputs: tc.inputs,
      evaluationRules: tc.evaluationRules,
    })),
    explanation: parsed.explanation,
    risk: parsed.risk,
  });

  return NextResponse.json(optimization);
}