/**
 * Workflow Test Case System（Part 1）
 *
 * Test Case:
 *   id, workflowId, workflowVersion, name, inputs, expectedOutputs, evaluationRules, createdAt, updatedAt
 *
 * Test Run:
 *   Test Case → Workflow Version → Execute → Actual Output → Evaluate → PASS / FAIL
 */

import type { EvaluationRule, EvaluationSummary, EvaluationType } from './evaluation';
import { evaluateOutput } from './evaluation';
import type { TinyflowData } from '../tinyflow/types';

export type { EvaluationType };

export interface WorkflowTestCase {
  id: string;
  workflowId: string;
  /** 测试针对的工作流版本（null = 始终针对当前/最新） */
  workflowVersion?: number | null;
  name: string;
  description?: string | null;
  inputs: Record<string, unknown>;
  /** 期望输出（exact/partial_match 用） */
  expectedOutputs?: Record<string, unknown> | null;
  evaluationRules: EvaluationRule[];
  createdAt?: string;
  updatedAt?: string;
}

export interface TestRunResult {
  id: string;
  testCaseId: string;
  workflowId: string;
  workflowVersion?: number | null;
  status: 'passed' | 'failed' | 'error';
  outcome: 'pass' | 'fail';
  /** 执行失败（非断言失败，如工作流报错/超时） */
  executionError?: string;
  /** 执行状态（completed/failed/...） */
  runStatus?: string;
  outputs?: Record<string, unknown>;
  evaluation?: EvaluationSummary;
  error?: string;
  durationMs: number;
  ranAt: string;
}

/**
 * 执行单个测试用例（针对特定 workflow data）。
 * @param flowData 要测试的工作流数据（已按 workflowVersion 选取）
 * @param testCase 测试用例
 */
export async function runTestCase(
  flowData: TinyflowData,
  testCase: WorkflowTestCase,
  options: { timeoutMs?: number } = {},
): Promise<TestRunResult> {
  const id = crypto.randomUUID();
  const start = Date.now();
  const { runWorkflow } = await import('./runner');

  const result = await runWorkflow(flowData, testCase.inputs, {
    timeoutMs: options.timeoutMs ?? 30_000,
    maxConcurrency: 1,
  });

  const durationMs = Date.now() - start;

  if (result.status !== 'completed') {
    return {
      id,
      testCaseId: testCase.id,
      workflowId: testCase.workflowId,
      workflowVersion: testCase.workflowVersion ?? null,
      status: 'error',
      outcome: 'fail',
      executionError: result.error,
      runStatus: result.status,
      error: result.error,
      durationMs,
      ranAt: new Date().toISOString(),
    };
  }

  const evaluation = evaluateOutput(result.outputs, testCase.evaluationRules);

  return {
    id,
    testCaseId: testCase.id,
    workflowId: testCase.workflowId,
    workflowVersion: testCase.workflowVersion ?? null,
    status: evaluation.overall === 'pass' ? 'passed' : 'failed',
    outcome: evaluation.overall,
    outputs: result.outputs,
    evaluation,
    durationMs,
    ranAt: new Date().toISOString(),
  };
}

/** 汇总多个测试运行结果 */
export function summarizeRuns(runs: TestRunResult[]): {
  passed: number;
  failed: number;
  error: number;
  total: number;
} {
  return {
    passed: runs.filter((r) => r.status === 'passed').length,
    failed: runs.filter((r) => r.status === 'failed').length,
    error: runs.filter((r) => r.status === 'error').length,
    total: runs.length,
  };
}
