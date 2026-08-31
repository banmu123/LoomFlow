/**
 * Quality Gate — Test Check
 *
 * 复用 workflow-copilot/test-case.ts 的 runTestCase。
 * required test timeout → fail（不是 warn）。
 * 无测试用例 + requireAtLeastOne=false → skip。
 */

import { runTestCase, summarizeRuns } from '@/lib/workflow-copilot/test-case';
import type { WorkflowTestCase } from '@/lib/workflow-copilot/test-case';
import type { GateCheckResult } from '../evaluator';
import type { TinyflowData } from '@/lib/tinyflow/types';

export async function checkTests(
  data: TinyflowData,
  testCases: WorkflowTestCase[],
  options: { minPassRate?: number; requireAtLeastOne?: boolean } = {},
): Promise<GateCheckResult> {
  const { minPassRate = 1.0, requireAtLeastOne = false } = options;
  const start = Date.now();

  // 无测试用例
  if (testCases.length === 0) {
    const durationMs = Date.now() - start;
    if (requireAtLeastOne) {
      return {
        name: 'tests',
        level: 'required',
        status: 'fail',
        message: '未配置测试用例（requireAtLeastOne=true）',
        durationMs,
      };
    }
    return {
      name: 'tests',
      level: 'required',
      status: 'skip',
      message: '无测试用例，跳过',
      durationMs,
    };
  }

  // 执行所有测试
  const results = [];
  for (const tc of testCases) {
    try {
      const result = await runTestCase(data, tc, { timeoutMs: 15_000 });
      results.push(result);
    } catch {
      // required test timeout → fail
      results.push({
        id: `timeout-${tc.id}`,
        testCaseId: tc.id,
        workflowId: '',
        status: 'error' as const,
        outcome: 'fail' as const,
        executionError: 'Test execution timeout',
        durationMs: 15_000,
        ranAt: new Date().toISOString(),
      });
    }
  }

  const summary = summarizeRuns(results);
  const durationMs = Date.now() - start;
  const passRate = summary.total > 0 ? summary.passed / summary.total : 0;

  if (passRate < minPassRate) {
    return {
      name: 'tests',
      level: 'required',
      status: 'fail',
      message: `测试通过率 ${(passRate * 100).toFixed(0)}%（阈值 ${(minPassRate * 100).toFixed(0)}%）：${summary.passed}/${summary.total} passed, ${summary.failed} failed, ${summary.error} error`,
      details: { summary, results: results.map((r) => ({ testCaseId: r.testCaseId, status: r.status, outcome: r.outcome })) },
      durationMs,
    };
  }

  return {
    name: 'tests',
    level: 'required',
    status: 'pass',
    message: `测试通过：${summary.passed}/${summary.total}`,
    details: { summary },
    durationMs,
  };
}
