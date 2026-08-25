/**
 * Skill Testing（Part 九）
 *
 * Skill 可绑定 Workflow 的 Test Cases；发布前 run-all → PASS 才允许。
 * 复用 copilot 的 test runner（runTestCase）与 test-case-store。
 */

import type { TinyflowData } from '../tinyflow/types';
import { runTestCase } from '../workflow-copilot/test-case';
import {
  getWorkflowDataAtVersion,
  listTestCases,
} from '../workflow-copilot/test-case-store';
import type { TestCaseRow } from '../workflow-copilot/test-case-store';

export interface SkillTestOutcome {
  passed: number;
  failed: number;
  error: number;
  total: number;
  results: Array<{ testCaseId: string; name: string; status: string; message?: string }>;
}

/** 获取 Skill 绑定工作流的测试用例 */
export async function getSkillTestCases(
  workflowId: string,
  userId: string,
): Promise<TestCaseRow[]> {
  return listTestCases(workflowId, userId);
}

/**
 * 运行 Skill 绑定工作流的全部测试。
 * @param flowData 被测工作流数据（可指定版本）
 */
export async function runSkillTests(
  workflowId: string,
  userId: string,
  flowData: TinyflowData,
): Promise<SkillTestOutcome> {
  const cases = await listTestCases(workflowId, userId);
  const results: SkillTestOutcome['results'] = [];
  for (const tc of cases) {
    const r = await runTestCase(flowData, {
      id: tc.id,
      workflowId,
      workflowVersion: tc.workflowVersion,
      name: tc.name,
      inputs: tc.inputs,
      evaluationRules: tc.evaluationRules,
    }, { timeoutMs: 15_000 });
    results.push({
      testCaseId: tc.id,
      name: tc.name,
      status: r.status,
      message: r.executionError || r.error || (r.evaluation ? r.evaluation.results.map((e) => e.message).join('；') : undefined),
    });
  }
  return {
    passed: results.filter((r) => r.status === 'passed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    error: results.filter((r) => r.status === 'error').length,
    total: results.length,
    results,
  };
}

/** 发布门禁：关键测试必须全过；无测试用例时返回提示（允许强制发布则由调用方决定） */
export function canPublish(outcome: SkillTestOutcome): { ok: boolean; reason?: string } {
  if (outcome.total === 0) {
    return { ok: true, reason: '暂无测试用例' };
  }
  if (outcome.failed > 0 || outcome.error > 0) {
    return { ok: false, reason: `有 ${outcome.failed + outcome.error} 个测试未通过（passed ${outcome.passed}/${outcome.total}）` };
  }
  return { ok: true };
}

export { getWorkflowDataAtVersion };
