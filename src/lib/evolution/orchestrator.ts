/**
 * Evolution Engine — Orchestrator
 *
 * 薄编排层：写事件 → 调用现有 optimize 管线 → 写结果。
 * 不含任何优化逻辑，只负责串联现有模块。
 *
 * 复用的现有模块：
 *   - workflow-eval/store.ts       (getWorkflowEval)
 *   - workflow-eval/metrics.ts     (aggregateNodeMetrics)
 *   - workflow-eval/bottleneck.ts  (detectBottlenecks)
 *   - workflow-eval/static-analysis.ts (analyzeWorkflow)
 *   - workflow-eval/ai-optimize.ts (buildOptimizationContext, extractOptimization, finalizeOptimization)
 *   - workflow-copilot/test-case-store.ts (listTestCases)
 */

import { supabase } from '@/lib/supabase/server';
import { generateText } from 'ai';
import { getProviderClientForModel } from '@/lib/ai';
import { getAllModels } from '@/lib/ai/db-models';
import { getWorkflowEval } from '../workflow-eval/store';
import { aggregateNodeMetrics } from '../workflow-eval/metrics';
import { detectBottlenecks } from '../workflow-eval/bottleneck';
import { analyzeWorkflow } from '../workflow-eval/static-analysis';
import {
  buildOptimizationContext,
  extractOptimization,
  finalizeOptimization,
  OPTIMIZE_SYSTEM_PROMPT,
} from '../workflow-eval/ai-optimize';
import { listTestCases } from '../workflow-copilot/test-case-store';
import type { TinyflowData } from '../tinyflow/types';
import type { EvolutionRule, DetectionResult, EvolutionAnalysisStatus } from './types';
import { diffToMarkdown } from '../workflow-copilot/diff';

// ===== Event Lifecycle =====

/** 创建 evolution_event 记录，返回 event_id */
export async function createEvent(
  rule: EvolutionRule,
  detection: DetectionResult,
): Promise<string> {
  const { data } = await supabase
    .from('evolution_events')
    .insert({
      workflow_id: rule.workflow_id,
      user_id: rule.user_id,
      rule_id: rule.id,
      trigger_type: rule.trigger_type,
      trigger_reason: detection.reason,
      metric_snapshot: detection.snapshot ?? null,
      analysis_status: 'pending',
    })
    .select('id')
    .single();
  return data?.id ?? '';
}

/** 更新事件状态 */
export async function updateEventStatus(
  eventId: string,
  status: EvolutionAnalysisStatus,
  extra?: { proposal_id?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  const patch: Record<string, unknown> = {
    analysis_status: status,
    updated_at: new Date().toISOString(),
  };
  if (extra?.proposal_id) patch.proposal_id = extra.proposal_id;
  if (extra?.metadata) patch.metadata = extra.metadata;
  await supabase.from('evolution_events').update(patch).eq('id', eventId);
}

// ===== Proposal Creation =====

/** 创建 evolution_proposal 记录，返回 proposal_id */
async function createProposal(params: {
  workflowId: string;
  userId: string;
  eventId: string;
  explanation: string;
  risk: string;
  operations: unknown[];
  proposal: unknown;
  schemaValid: boolean;
  issues: unknown[];
  testSummary: unknown | null;
  diffMarkdown: string | null;
  idempotencyKey: string;
}): Promise<string | null> {
  const { data, error } = await supabase
    .from('evolution_proposals')
    .insert({
      workflow_id: params.workflowId,
      user_id: params.userId,
      event_id: params.eventId,
      explanation: params.explanation,
      risk: params.risk,
      operations: params.operations,
      proposal: params.proposal,
      schema_valid: params.schemaValid,
      issues: params.issues,
      test_summary: params.testSummary,
      diff_markdown: params.diffMarkdown,
      status: 'pending',
      idempotency_key: params.idempotencyKey,
    })
    .select('id')
    .single();

  // 幂等冲突：同一 rule+date 已有 proposal → 跳过
  if (error?.code === '23505') return null;
  return data?.id ?? null;
}

// ===== Pipeline =====

export interface PipelineResult {
  eventId: string;
  status: 'proposal_created' | 'no_change' | 'failed';
  proposalId?: string;
}

/**
 * 完整的优化管线：触发 → 分析 → proposal。
 * 复用现有 eval + copilot 模块，不含优化逻辑。
 */
export async function runOptimizationPipeline(
  rule: EvolutionRule,
  detection: DetectionResult,
): Promise<PipelineResult> {
  // 1. 创建事件
  const eventId = await createEvent(rule, detection);
  if (!eventId) return { eventId: '', status: 'failed' };

  // 2. 更新状态 → analyzing
  await updateEventStatus(eventId, 'analyzing');

  try {
    // 3. 加载工作流
    const { data: wf } = await supabase
      .from('workflow_history')
      .select('data')
      .eq('id', rule.workflow_id)
      .single();
    const workflow = wf?.data as TinyflowData | undefined;
    if (!workflow?.nodes) throw new Error('工作流数据为空');

    // 4. 复用现有 eval 模块（不重构）
    const evalData = await getWorkflowEval(rule.workflow_id, rule.user_id, '7d');
    if (evalData.selectedRuns.length === 0) {
      await updateEventStatus(eventId, 'no_change');
      return { eventId, status: 'no_change' };
    }

    const nodeResult = aggregateNodeMetrics(evalData.selectedRuns);
    const bottlenecks = detectBottlenecks(evalData.workflow, nodeResult.nodes);
    const staticAnalysis = analyzeWorkflow(workflow);
    const testCases = await listTestCases(rule.workflow_id, rule.user_id);

    // 5. 调 AI（复用 ai-optimize.ts）
    const allModels = await getAllModels();
    if (allModels.length === 0) throw new Error('未配置模型');
    const model = allModels[0];
    const provider = getProviderClientForModel(model);
    if (!provider) throw new Error(`未知 provider: ${model.provider}`);

    const contextText = buildOptimizationContext({
      workflow,
      workflowId: rule.workflow_id,
      metrics: evalData.workflow,
      nodes: nodeResult.nodes,
      bottlenecks,
      staticAnalysis,
      testCases: testCases.map((tc) => ({ name: tc.name })),
    });

    const { text } = await generateText({
      model: provider(model.id),
      system: OPTIMIZE_SYSTEM_PROMPT,
      prompt: `${contextText}\n\n触发原因：${detection.reason}\n\n请输出优化 Patch（JSON）。`,
      temperature: 0.4,
      maxOutputTokens: 4096,
    });

    const parsed = extractOptimization(text);
    if (!Array.isArray(parsed.operations) || parsed.operations.length === 0) {
      await updateEventStatus(eventId, 'no_change');
      return { eventId, status: 'no_change' };
    }

    // 6. 复用 proposal 管线
    const optimization = await finalizeOptimization(workflow, parsed.operations, {
      workflowId: rule.workflow_id,
      testCases: testCases.map((tc) => ({
        id: tc.id,
        workflowId: rule.workflow_id,
        workflowVersion: tc.workflowVersion,
        name: tc.name,
        inputs: tc.inputs,
        evaluationRules: tc.evaluationRules,
      })),
      explanation: parsed.explanation,
      risk: parsed.risk,
    });

    // 7. 幂等 key：rule_id + 日期
    const dateStr = new Date().toISOString().slice(0, 10);
    const idempotencyKey = `${rule.id}:${dateStr}`;

    // 8. 写 proposal
    const proposalId = await createProposal({
      workflowId: rule.workflow_id,
      userId: rule.user_id,
      eventId,
      explanation: optimization.explanation,
      risk: optimization.risk,
      operations: parsed.operations ?? [],
      proposal: optimization.proposal,
      schemaValid: optimization.proposal.schema.valid,
      issues: optimization.proposal.issues,
      testSummary: optimization.proposal.testsSummary ?? null,
      diffMarkdown: optimization.markdown,
      idempotencyKey,
    });

    if (!proposalId) {
      // 幂等冲突：今天已有 proposal
      await updateEventStatus(eventId, 'no_change', { metadata: { reason: 'duplicate' } });
      return { eventId, status: 'no_change' };
    }

    // 9. 更新事件 → proposal_created
    await updateEventStatus(eventId, 'proposal_created', { proposal_id: proposalId });
    return { eventId, status: 'proposal_created', proposalId };

  } catch (err) {
    await updateEventStatus(eventId, 'failed', {
      metadata: { error: (err as Error).message },
    });
    return { eventId, status: 'failed' };
  }
}
