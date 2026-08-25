/**
 * Patch Validation Pipeline（Part 5）
 *
 * AI Patch 不能直接写入正式 Workflow，必须：
 *   AI Patch → Apply to temporary copy → Schema Validation → Dependency Validation
 *   → (Executor registration check) → Test → Show Diff → User Approve → Save New Version
 *
 * 本模块提供 apply + 校验，产出 Proposal（含 diff / 校验结果 / 测试结果）。
 * 是否生成新版本由上层在「用户批准」后调用版本保存 API 决定——本模块不落库。
 */

import type { TinyflowData } from '../tinyflow/types';
import { validateWorkflow } from '../tinyflow/schema';
import { diffWorkflow } from './diff';
import { applyPatch, type PatchOperation } from './patch';
import type { WorkflowTestCase, TestRunResult } from './test-case';
import { runTestCase } from './test-case';
import { checkDependencies } from './dependency';
import type { ValidationIssue } from './dependency';

export interface ProposalTestResult {
  testCaseId: string;
  name: string;
  status: TestRunResult['status'];
  message?: string;
}

export interface PatchProposal {
  workflowId: string;
  fromVersion?: number;
  operations: PatchOperation[];
  /** 应用后的新工作流（临时副本；尚未保存为新版本） */
  proposed: TinyflowData;
  /** schema 校验 */
  schema: { valid: boolean; errors: string[] };
  /** 依赖校验 */
  issues: ValidationIssue[];
  /** 测试结果（若执行了测试） */
  tests?: ProposalTestResult[];
  testsSummary?: { passed: number; failed: number; error: number; total: number };
  /** diff（AI 可读） */
  diff: ReturnType<typeof diffWorkflow>;
  /** 人类可读说明 */
  description: string;
}

const EXECUTOR_TYPES = new Set([
  'startNode',
  'endNode',
  'llmNode',
  'httpNode',
  'codeNode',
  'knowledgeNode',
  'searchEngineNode',
  'templateNode',
  'conditionNode',
  'confirmNode',
  'loopNode',
  'excelNode',
]);

/**
 * 构建并校验一个 AI Proposal。
 * @param current 当前工作流版本快照
 * @param operations AI 输出的 patch
 * @param options.validateAndRunTests 是否执行 schema/依赖/测试校验
 */
export async function buildProposal(
  current: TinyflowData,
  operations: PatchOperation[],
  options: {
    workflowId: string;
    fromVersion?: number;
    tests?: WorkflowTestCase[];
    runTests?: boolean;
    description?: string;
  },
): Promise<PatchProposal> {
  // 1. apply 到临时副本
  const applied = applyPatch(current, operations);
  if (applied.errors.length > 0) {
    // 仍有问题的 patch：proposed 用 partial，但标记
  }
  const proposed = applied.workflow;

  // 2. schema 校验
  const schema = validateWorkflow(proposed);
  const schemaErrors = schema.errors.map((e) => e.message);

  // 3. 依赖校验（悬空引用 / 未知执行器）
  const issues: ValidationIssue[] = checkDependencies(proposed);

  // 4. 测试（可选）
  let tests: ProposalTestResult[] | undefined;
  let testsSummary: { passed: number; failed: number; error: number; total: number } | undefined;
  if (options.runTests && options.tests && options.tests.length > 0) {
    tests = [];
    for (const tc of options.tests) {
      const r = await runTestCase(proposed, tc, { timeoutMs: 15_000 });
      tests.push({
        testCaseId: tc.id,
        name: tc.name,
        status: r.status,
        message: r.executionError || r.error || (r.evaluation ? r.evaluation.results.map((e) => e.message).join('；') : undefined),
      });
    }
    testsSummary = {
      passed: tests.filter((t) => t.status === 'passed').length,
      failed: tests.filter((t) => t.status === 'failed').length,
      error: tests.filter((t) => t.status === 'error').length,
      total: tests.length,
    };
  }

  // 5. diff
  const diff = diffWorkflow(current, proposed, { from: options.fromVersion });

  return {
    workflowId: options.workflowId,
    fromVersion: options.fromVersion,
    operations,
    proposed,
    schema: { valid: schema.valid, errors: schemaErrors },
    issues,
    tests,
    testsSummary,
    diff,
    description: options.description ?? `应用 ${operations.length} 条修改`,
  };
}

export { EXECUTOR_TYPES };
