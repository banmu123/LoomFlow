/**
 * AI Optimization（Part 七 / 八）
 *
 * Workflow → Metrics → Trace → Tests → Static Analysis → AI Analysis → Optimization Proposal
 *
 * AI 只输出 Patch operations（复用 copilot patch schema），
 * 系统负责：apply 副本 → schema/依赖校验 → 跑测试 → Benchmark 对比 → 用户批准 → 新版本。
 */

import type { TinyflowData } from '../tinyflow/types';
import type { WorkflowMetrics, NodeMetrics } from './metrics';
import type { BottleneckReport } from './bottleneck';
import type { StaticAnalysisResult } from './static-analysis';
import { buildProposal } from '../workflow-copilot/proposal';
import type { PatchOperation } from '../workflow-copilot/patch';
import { diffToMarkdown } from '../workflow-copilot/diff';

export interface OptimizationInput {
  workflow: TinyflowData;
  workflowId: string;
  fromVersion?: number;
  metrics: WorkflowMetrics;
  nodes: NodeMetrics[];
  bottlenecks: BottleneckReport;
  staticAnalysis: StaticAnalysisResult;
  recentTrace?: unknown;
  testCases?: Array<{ name: string; status?: string }>;
}

export interface OptimizationResult {
  proposal: Awaited<ReturnType<typeof buildProposal>>;
  explanation: string;
  risk: string;
  canSave: boolean;
  markdown: string;
}

/** 把评估数据组装成给 AI 的上下文（token 裁剪） */
export function buildOptimizationContext(input: OptimizationInput): string {
  const lines: string[] = [];
  lines.push('## 当前工作流 Metrics');
  lines.push(
    JSON.stringify({
      totalRuns: input.metrics.totalRuns,
      successRate: input.metrics.successRate,
      latencyMs: input.metrics.averageLatencyMs,
      p95LatencyMs: input.metrics.p95LatencyMs,
      costPerRun: input.metrics.estimatedCostPerRun,
      totalTokens: input.metrics.averageTokenUsage,
      failureRate: input.metrics.failureRate,
      retryRate: input.metrics.retryRate,
      timeoutRate: input.metrics.timeoutRate,
    }, null, 2),
  );
  lines.push('');
  lines.push('## Node Metrics');
  lines.push(
    JSON.stringify(
      input.nodes.map((nd) => ({
        id: nd.nodeId,
        title: nd.title,
        type: nd.type,
        avgDurationMs: nd.averageDurationMs,
        failureRate: nd.failureRate,
        retryCount: nd.retryCount,
        cost: nd.estimatedCost,
      })),
      null,
      2,
    ),
  );
  lines.push('');
  lines.push(`## 瓶颈分析\n${input.bottlenecks.summary}`);
  lines.push('');
  if (input.staticAnalysis.findings.length > 0) {
    lines.push('## 静态分析');
    lines.push(JSON.stringify(input.staticAnalysis.findings.slice(0, 15), null, 2));
  }
  if (input.staticAnalysis.parallelizable.length > 0) {
    lines.push(`可并行节点对：${input.staticAnalysis.parallelizable.slice(0, 8).map(([a, b]) => `${a}∥${b}`).join('、')}`);
  }
  if (input.testCases?.length) {
    lines.push(`## 测试用例（${input.testCases.length} 个）`);
    lines.push(input.testCases.map((tc) => `- ${tc.name}${tc.status ? `（${tc.status}）` : ''}`).join('\n'));
  }
  lines.push('## 当前工作流（nodes/edges 概要）');
  lines.push(
    JSON.stringify(
      {
        nodes: input.workflow.nodes.map((nd) => ({ id: nd.id, type: nd.type, title: nd.data?.title })),
        edges: input.workflow.edges.map((e) => `${e.source}→${e.target}`),
      },
      null,
      2,
    ),
  );
  return lines.join('\n\n');
}

export const OPTIMIZE_SYSTEM_PROMPT = `你是 LoomFlow 的 Workflow Optimization Engineer。
根据给定的 Metrics / Node Metrics / 瓶颈分析 / 静态分析 / 测试用例，输出**增量优化方案 Patch**：
- 目标：更快的延迟、更低的成本、更高的成功率/准确性
- 只输出用户要求的优化，不要无关改动
- 保持已有节点 id 不变；新增节点用新 id
- 输出 JSON（不要输出 JSON 之外文字）：
{
  "explanation": "本次优化说明（当前 → 拟达到：延迟/cost 变化）",
  "risk": "潜在风险",
  "operations": [{"op":"add_node|remove_node|update_node|move_node|connect|disconnect|replace_node|update_workflow_metadata", ...}]
}`;

/** 调 AI 生成优化 patch（由 API 层传入 provider；这里只做组装与解析） */
export function extractOptimization(raw: string): { explanation?: string; risk?: string; operations?: PatchOperation[] } {
  try {
    return JSON.parse(raw) as { explanation?: string; risk?: string; operations?: PatchOperation[] };
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as { explanation?: string; risk?: string; operations?: PatchOperation[] };
      } catch {
        return {};
      }
    }
    return {};
  }
}

/** AI 生成 patch 后进入 copilot 校验管线（跑测试） */
export async function finalizeOptimization(
  current: TinyflowData,
  operations: PatchOperation[],
  options: { workflowId: string; fromVersion?: number; testCases?: Parameters<typeof buildProposal>[2]['tests']; explanation?: string; risk?: string },
): Promise<OptimizationResult> {
  const proposal = await buildProposal(current, operations, {
    workflowId: options.workflowId,
    fromVersion: options.fromVersion,
    tests: options.testCases,
    runTests: !!options.testCases && options.testCases.length > 0,
    description: options.explanation,
  });
  const canSave = proposal.schema.valid && !proposal.issues.some((i) => i.level === 'error');
  return {
    proposal,
    explanation: options.explanation ?? 'AI 优化建议',
    risk: options.risk ?? '未知',
    canSave,
    markdown: diffToMarkdown(proposal.diff),
  };
}