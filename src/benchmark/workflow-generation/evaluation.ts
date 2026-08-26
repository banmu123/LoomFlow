/**
 * Workflow Generation Benchmark - Evaluation Script
 *
 * 评估 AI 生成的 Workflow 质量
 */

import type { TinyflowData } from '../../lib/tinyflow/types';
import { validateWorkflow } from '../../lib/tinyflow/schema';
import { FlowEngine } from '../../lib/tinyflow/engine/FlowEngine';
import type { BenchmarkTestCase } from './test-cases';
import { ALL_CASES, getCasesByCategory } from './test-cases';

// ===== 评估结果类型 =====

export interface EvaluationScores {
  schemaValidity: number;      // 0-100
  nodeCorrectness: number;     // 0-100
  executionSuccess: number;    // 0-100
}

export interface CaseResult {
  caseId: string;
  category: string;
  input: string;
  generated: TinyflowData | null;
  scores: EvaluationScores;
  totalScore: number;
  passed: boolean;
  errors: string[];
  durationMs: number;
  tokens?: number;
  cost?: number;
}

export interface BenchmarkSummary {
  totalCases: number;
  passed: number;
  failed: number;
  generationSuccessRate: number;
  schemaValidationRate: number;
  executionSuccessRate: number;
  repairRate: number;
  averageTokens: number;
  averageCost: number;
  averageScore: number;
}

export interface BenchmarkResult {
  timestamp: string;
  model: string;
  summary: BenchmarkSummary;
  results: CaseResult[];
}

// ===== 评估函数 =====

/**
 * 评估 Schema 有效性
 */
export function evaluateSchemaValidity(workflow: TinyflowData | null): number {
  if (!workflow) return 0;

  const result = validateWorkflow(workflow);
  if (result.valid) return 100;

  // 扣分：每个错误扣 20 分
  const errorCount = result.errors.length;
  const criticalErrors = result.errors.filter(e =>
    ['missing_start', 'missing_end', 'invalid_flow', 'missing_field'].includes(e.code)
  ).length;

  // 关键错误直接 0 分
  if (criticalErrors > 0) return 0;

  // 非关键错误按比例扣分
  return Math.max(0, 100 - errorCount * 20);
}

/**
 * 评估节点正确性
 */
export function evaluateNodeCorrectness(
  workflow: TinyflowData | null,
  expected: BenchmarkTestCase['expected']
): number {
  if (!workflow) return 0;

  const actualNodeTypes = workflow.nodes
    .filter(n => !['startNode', 'endNode'].includes(n.type))
    .map(n => n.type);

  let score = 0;
  const weights = {
    nodeTypeMatch: 50,      // 节点类型匹配
    nodeCount: 20,           // 节点数量合理
    connections: 15,         // 连接数合理
    structure: 15,           // 结构合理
  };

  // 1. 节点类型匹配 (50%)
  const expectedTypes = expected.nodeTypes;
  let matchedTypes = 0;
  for (const expectedType of expectedTypes) {
    if (actualNodeTypes.includes(expectedType)) {
      matchedTypes++;
    }
  }
  const typeScore = expectedTypes.length > 0
    ? (matchedTypes / expectedTypes.length) * weights.nodeTypeMatch
    : weights.nodeTypeMatch;
  score += typeScore;

  // 2. 节点数量合理 (20%)
  const nodeCount = workflow.nodes.length;
  if (nodeCount >= expected.minNodes && nodeCount <= expected.maxNodes) {
    score += weights.nodeCount;
  } else if (nodeCount >= expected.minNodes - 1 && nodeCount <= expected.maxNodes + 1) {
    score += weights.nodeCount * 0.5; // 接近范围给一半分
  }

  // 3. 连接数合理 (15%)
  const edgeCount = workflow.edges.length;
  if (edgeCount >= expected.requiredConnections) {
    score += weights.connections;
  } else if (edgeCount >= expected.requiredConnections - 1) {
    score += weights.connections * 0.5;
  }

  // 4. 结构合理 (15%)
  const hasStart = workflow.nodes.some(n => n.type === 'startNode');
  const hasEnd = workflow.nodes.some(n => n.type === 'endNode');
  if (hasStart && hasEnd) {
    score += weights.structure;
  }

  return Math.round(Math.min(100, score));
}

/**
 * 评估执行成功率
 */
export async function evaluateExecutionSuccess(
  workflow: TinyflowData | null
): Promise<number> {
  if (!workflow) return 0;

  // 验证 schema
  const validation = validateWorkflow(workflow);
  if (!validation.valid) return 0;

  // 尝试执行
  const engine = new FlowEngine(workflow, {
    flowData: workflow,
    inputs: { query: 'benchmark test input' },
    timeoutMs: 10000,
    defaultNodeTimeoutMs: 5000,
    maxConcurrency: 1,
  });

  try {
    await engine.run();
    const state = engine.getState();
    return state === 'completed' ? 100 : 0;
  } catch (error) {
    // 如果是 LLM 调用失败（因为 API key），给部分分数
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('未知模型') || errorMessage.includes('API')) {
      return 50; // 结构正确但执行环境问题
    }
    return 0;
  }
}

/**
 * 计算总分
 */
export function calculateTotalScore(
  scores: EvaluationScores,
  weights: BenchmarkTestCase['evaluationWeights']
): number {
  return Math.round(
    scores.schemaValidity * weights.schemaValidity +
    scores.nodeCorrectness * weights.nodeCorrectness +
    scores.executionSuccess * weights.executionSuccess
  );
}

/**
 * 评估单个测试用例
 */
export async function evaluateTestCase(
  testCase: BenchmarkTestCase,
  generated: TinyflowData | null,
  tokenUsage?: { tokens: number; cost: number }
): Promise<CaseResult> {
  const startTime = Date.now();

  // 评估各维度
  const scores: EvaluationScores = {
    schemaValidity: evaluateSchemaValidity(generated),
    nodeCorrectness: evaluateNodeCorrectness(generated, testCase.expected),
    executionSuccess: await evaluateExecutionSuccess(generated),
  };

  // 计算总分
  const totalScore = calculateTotalScore(scores, testCase.evaluationWeights);

  // 判断是否通过（60分及格）
  const passed = totalScore >= 60;

  // 收集错误信息
  const errors: string[] = [];
  if (!generated) {
    errors.push('Generation failed - no workflow produced');
  } else {
    const validation = validateWorkflow(generated);
    if (!validation.valid) {
      errors.push(...validation.errors.map(e => e.message));
    }
  }

  return {
    caseId: testCase.id,
    category: testCase.category,
    input: testCase.input,
    generated,
    scores,
    totalScore,
    passed,
    errors,
    durationMs: Date.now() - startTime,
    tokens: tokenUsage?.tokens,
    cost: tokenUsage?.cost,
  };
}

/**
 * 运行完整 Benchmark
 */
export async function runBenchmark(
  generateFn: (input: string) => Promise<{ workflow: TinyflowData | null; tokens?: number; cost?: number }>,
  options: {
    category?: 'simple' | 'medium' | 'complex' | 'all';
    cases?: string[];
  } = {}
): Promise<BenchmarkResult> {
  const { category = 'all', cases: caseIds } = options;

  // 获取测试用例
  let testCases = category === 'all' ? ALL_CASES : getCasesByCategory(category);
  if (caseIds && caseIds.length > 0) {
    testCases = testCases.filter(c => caseIds.includes(c.id));
  }

  const results: CaseResult[] = [];
  let totalTokens = 0;
  let totalCost = 0;

  // 执行每个测试用例
  for (const testCase of testCases) {
    try {
      const { workflow, tokens = 0, cost = 0 } = await generateFn(testCase.input);
      const result = await evaluateTestCase(testCase, workflow, { tokens, cost });
      results.push(result);

      totalTokens += tokens;
      totalCost += cost;
    } catch (error) {
      // 生成失败
      results.push({
        caseId: testCase.id,
        category: testCase.category,
        input: testCase.input,
        generated: null,
        scores: { schemaValidity: 0, nodeCorrectness: 0, executionSuccess: 0 },
        totalScore: 0,
        passed: false,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        durationMs: 0,
      });
    }
  }

  // 计算汇总
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  const validWorkflows = results.filter(r => r.generated !== null).length;
  const schemaValid = results.filter(r => r.scores.schemaValidity >= 80).length;
  const executionSuccess = results.filter(r => r.scores.executionSuccess >= 80).length;

  const summary: BenchmarkSummary = {
    totalCases: results.length,
    passed,
    failed,
    generationSuccessRate: results.length > 0 ? Math.round((validWorkflows / results.length) * 100) : 0,
    schemaValidationRate: results.length > 0 ? Math.round((schemaValid / results.length) * 100) : 0,
    executionSuccessRate: results.length > 0 ? Math.round((executionSuccess / results.length) * 100) : 0,
    repairRate: results.length > 0 ? Math.round(((results.length - schemaValid) / results.length) * 100) : 0,
    averageTokens: results.length > 0 ? Math.round(totalTokens / results.length) : 0,
    averageCost: results.length > 0 ? Math.round((totalCost / results.length) * 10000) / 10000 : 0,
    averageScore: results.length > 0 ? Math.round(results.reduce((sum, r) => sum + r.totalScore, 0) / results.length) : 0,
  };

  return {
    timestamp: new Date().toISOString(),
    model: 'unknown',
    summary,
    results,
  };
}

/**
 * 生成 Markdown 报告
 */
export function generateMarkdownReport(result: BenchmarkResult): string {
  const lines: string[] = [];

  lines.push('# Workflow Generation Benchmark Report');
  lines.push('');
  lines.push(`**Date**: ${result.timestamp}`);
  lines.push(`**Model**: ${result.model}`);
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total Cases | ${result.summary.totalCases} |`);
  lines.push(`| Passed | ${result.summary.passed} |`);
  lines.push(`| Failed | ${result.summary.failed} |`);
  lines.push(`| Generation Success Rate | ${result.summary.generationSuccessRate}% |`);
  lines.push(`| Schema Validation Rate | ${result.summary.schemaValidationRate}% |`);
  lines.push(`| Execution Success Rate | ${result.summary.executionSuccessRate}% |`);
  lines.push(`| Repair Rate | ${result.summary.repairRate}% |`);
  lines.push(`| Average Tokens | ${result.summary.averageTokens} |`);
  lines.push(`| Average Cost | $${result.summary.averageCost} |`);
  lines.push(`| Average Score | ${result.summary.averageScore} |`);
  lines.push('');

  // Results by category
  const categories = ['simple', 'medium', 'complex'];
  for (const category of categories) {
    const categoryResults = result.results.filter(r => r.category === category);
    if (categoryResults.length === 0) continue;

    lines.push(`## ${category.charAt(0).toUpperCase() + category.slice(1)} Cases`);
    lines.push('');
    lines.push('| Case | Score | Schema | Nodes | Execution | Status |');
    lines.push('|------|-------|--------|-------|-----------|--------|');

    for (const r of categoryResults) {
      const status = r.passed ? '✅' : '❌';
      lines.push(`| ${r.caseId} | ${r.totalScore} | ${r.scores.schemaValidity} | ${r.scores.nodeCorrectness} | ${r.scores.executionSuccess} | ${status} |`);
    }
    lines.push('');
  }

  // Failed cases details
  const failedCases = result.results.filter(r => !r.passed);
  if (failedCases.length > 0) {
    lines.push('## Failed Cases');
    lines.push('');
    for (const r of failedCases) {
      lines.push(`### ${r.caseId}`);
      lines.push(`- **Input**: ${r.input}`);
      lines.push(`- **Score**: ${r.totalScore}`);
      lines.push(`- **Errors**: ${r.errors.join(', ')}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * 生成 JSON 结果
 */
export function generateJsonResult(result: BenchmarkResult): string {
  return JSON.stringify(result, null, 2);
}
