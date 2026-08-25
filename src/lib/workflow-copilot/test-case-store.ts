import { supabase } from '@/lib/supabase/server';
import type { EvaluationRule } from './evaluation';

export interface TestCaseRow {
  id: string;
  workflowId: string;
  userId: string;
  workflowVersion: number | null;
  name: string;
  description: string | null;
  inputs: Record<string, unknown>;
  expectedOutputs: Record<string, unknown> | null;
  evaluationRules: EvaluationRule[];
  createdAt: string;
  updatedAt: string;
}

export interface TestRunRow {
  id: string;
  testCaseId: string;
  workflowId: string;
  workflowVersion: number | null;
  status: 'passed' | 'failed' | 'error';
  outcome: string;
  executionError: string | null;
  runStatus: string | null;
  outputs: Record<string, unknown> | null;
  evaluation: unknown;
  error: string | null;
  durationMs: number;
  ranAt: string;
}

/** 校验工作流归属（继承 workflow-notes 的模式） */
export async function ensureWorkflowOwnership(
  workflowId: string,
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data } = await supabase
    .from('workflow_history')
    .select('id')
    .eq('id', workflowId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return { ok: false, error: '工作流不存在或无权访问' };
  return { ok: true };
}

const toRow = (r: Record<string, unknown>): TestCaseRow => ({
  id: String(r.id),
  workflowId: String(r.workflow_id),
  userId: String(r.user_id),
  workflowVersion: r.workflow_version as number | null,
  name: String(r.name),
  description: (r.description as string | null) ?? null,
  inputs: (r.inputs ?? {}) as Record<string, unknown>,
  expectedOutputs: (r.expected_outputs ?? null) as Record<string, unknown> | null,
  evaluationRules: (r.evaluation_rules ?? []) as EvaluationRule[],
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

/** 列出工作流的测试用例（本人） */
export async function listTestCases(
  workflowId: string,
  userId: string,
): Promise<TestCaseRow[]> {
  const { data } = await supabase
    .from('workflow_test_cases')
    .select('*')
    .eq('workflow_id', workflowId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  return (data ?? []).map(toRow);
}

/** 创建测试用例 */
export async function createTestCase(
  workflowId: string,
  userId: string,
  input: {
    workflowVersion?: number | null;
    name: string;
    description?: string;
    inputs?: Record<string, unknown>;
    expectedOutputs?: Record<string, unknown>;
    evaluationRules?: EvaluationRule[];
  },
): Promise<{ error?: string; testCase?: TestCaseRow }> {
  const name = (input.name || '').trim();
  if (!name) return { error: '测试用例名称不能为空' };

  const { data, error } = await supabase
    .from('workflow_test_cases')
    .insert({
      workflow_id: workflowId,
      user_id: userId,
      workflow_version: input.workflowVersion ?? null,
      name,
      description: input.description?.trim() || null,
      inputs: input.inputs ?? {},
      expected_outputs: input.expectedOutputs ?? null,
      evaluation_rules: input.evaluationRules ?? [],
    })
    .select('*')
    .single();
  if (error) return { error: error.message };
  return { testCase: toRow(data) };
}

/** 更新测试用例（校验归属） */
export async function updateTestCase(
  testCaseId: string,
  userId: string,
  updates: Partial<{
    workflowVersion: number | null;
    name: string;
    description: string;
    inputs: Record<string, unknown>;
    expectedOutputs: Record<string, unknown> | null;
    evaluationRules: EvaluationRule[];
  }>,
): Promise<{ error?: string; testCase?: TestCaseRow }> {
  const { data: owner } = await supabase
    .from('workflow_test_cases')
    .select('user_id')
    .eq('id', testCaseId)
    .maybeSingle();
  if (!owner) return { error: '测试用例不存在' };
  if (owner.user_id !== userId) return { error: '无权操作该测试用例' };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.workflowVersion !== undefined) patch.workflow_version = updates.workflowVersion;
  if (updates.name !== undefined) patch.name = updates.name.trim();
  if (updates.description !== undefined) patch.description = updates.description || null;
  if (updates.inputs !== undefined) patch.inputs = updates.inputs;
  if (updates.expectedOutputs !== undefined) patch.expected_outputs = updates.expectedOutputs;
  if (updates.evaluationRules !== undefined) patch.evaluation_rules = updates.evaluationRules;

  const { data, error } = await supabase
    .from('workflow_test_cases')
    .update(patch)
    .eq('id', testCaseId)
    .select('*')
    .single();
  if (error) return { error: error.message };
  return { testCase: toRow(data) };
}

/** 删除测试用例（校验归属） */
export async function deleteTestCase(
  testCaseId: string,
  userId: string,
): Promise<{ error?: string }> {
  const { data: owner } = await supabase
    .from('workflow_test_cases')
    .select('user_id')
    .eq('id', testCaseId)
    .maybeSingle();
  if (!owner) return { error: '测试用例不存在' };
  if (owner.user_id !== userId) return { error: '无权操作该测试用例' };
  const { error } = await supabase.from('workflow_test_cases').delete().eq('id', testCaseId);
  if (error) return { error: error.message };
  return {};
}

/** 保存一次测试运行（结果历史） */
export async function saveTestRun(run: {
  testCaseId: string;
  workflowId: string;
  workflowVersion: number | null;
  status: string;
  outcome: string;
  executionError?: string | null;
  runStatus?: string | null;
  outputs?: Record<string, unknown> | null;
  evaluation?: unknown;
  error?: string | null;
  durationMs: number;
}): Promise<void> {
  await supabase.from('workflow_test_runs').insert({
    test_case_id: run.testCaseId,
    workflow_id: run.workflowId,
    workflow_version: run.workflowVersion,
    status: run.status,
    outcome: run.outcome,
    execution_error: run.executionError ?? null,
    run_status: run.runStatus ?? null,
    outputs: run.outputs ?? null,
    evaluation: run.evaluation ?? null,
    error: run.error ?? null,
    duration_ms: run.durationMs,
  });
}

/** 测试运行结果历史（某工作流，倒序） */
export async function listTestRuns(
  workflowId: string,
  limit = 30,
): Promise<TestRunRow[]> {
  const { data } = await supabase
    .from('workflow_test_runs')
    .select('*')
    .eq('workflow_id', workflowId)
    .order('ran_at', { ascending: false })
    .limit(limit);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    testCaseId: String(r.test_case_id),
    workflowId: String(r.workflow_id),
    workflowVersion: r.workflow_version as number | null,
    status: r.status as TestRunRow['status'],
    outcome: String(r.outcome),
    executionError: (r.execution_error as string | null) ?? null,
    runStatus: (r.run_status as string | null) ?? null,
    outputs: (r.outputs ?? null) as Record<string, unknown> | null,
    evaluation: r.evaluation,
    error: (r.error as string | null) ?? null,
    durationMs: Number(r.duration_ms ?? 0),
    ranAt: String(r.ran_at),
  }));
}

/** 取工作流指定版本的 data（用于测试执行）；缺省取当前 */
export async function getWorkflowDataAtVersion(
  workflowId: string,
  userId: string,
  version?: number | null,
): Promise<{ data: unknown; version?: number | null; error?: string }> {
  const { data: wf } = await supabase
    .from('workflow_history')
    .select('id, user_id, data')
    .eq('id', workflowId)
    .maybeSingle();
  if (!wf || wf.user_id !== userId) return { data: null, error: '工作流不存在或无权访问' };

  if (version) {
    const { data: ver } = await supabase
      .from('workflow_versions')
      .select('data, version')
      .eq('workflow_id', workflowId)
      .eq('version', version)
      .maybeSingle();
    if (!ver) return { data: null, error: `版本 v${version} 不存在` };
    return { data: ver.data, version: ver.version };
  }
  return { data: wf.data, version: null };
}
