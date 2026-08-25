import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import {
  ensureWorkflowOwnership,
  listTestCases,
  getWorkflowDataAtVersion,
  saveTestRun,
  TestCaseRow,
} from '@/lib/workflow-copilot/test-case-store';
import { runTestCase } from '@/lib/workflow-copilot/test-case';
import type { TinyflowData } from '@/lib/tinyflow/types';

export const runtime = 'nodejs';

/**
 * 运行测试
 * body:
 *   workflowId (必填)
 *   testCaseId?  指定单测（缺省跑全部）
 *   workflowVersion?  指定工作流版本（缺省当前）
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const workflowId = body?.workflowId as string | undefined;
  if (!workflowId) return NextResponse.json({ error: 'workflowId 必填' }, { status: 400 });

  const own = await ensureWorkflowOwnership(workflowId, user.id);
  if (!own.ok) return NextResponse.json({ error: own.error }, { status: 403 });

  // 取被测工作流数据（指定版本或当前）
  const { data, version, error } = await getWorkflowDataAtVersion(
    workflowId,
    user.id,
    body.workflowVersion ?? null,
  );
  if (error || !data) return NextResponse.json({ error: error ?? '无法读取工作流' }, { status: 400 });
  const flowData = data as TinyflowData;

  const all = await listTestCases(workflowId, user.id);
  const targets: TestCaseRow[] = body.testCaseId
    ? all.filter((t) => t.id === body.testCaseId)
    : all;

  if (targets.length === 0) {
    return NextResponse.json({ error: '没有可运行的测试用例' }, { status: 400 });
  }

  const runs = [];
  for (const tc of targets) {
    const run = await runTestCase(flowData, {
      id: tc.id,
      workflowId,
      workflowVersion: body.workflowVersion ?? tc.workflowVersion,
      name: tc.name,
      inputs: tc.inputs,
      evaluationRules: tc.evaluationRules,
    }, { timeoutMs: 30_000 });
    // 落库结果历史
    await saveTestRun({
      testCaseId: tc.id,
      workflowId,
      workflowVersion: run.workflowVersion ?? null,
      status: run.status,
      outcome: run.outcome,
      executionError: run.executionError,
      runStatus: run.runStatus,
      outputs: run.outputs,
      evaluation: run.evaluation,
      error: run.error,
      durationMs: run.durationMs,
    });
    runs.push({ ...run, name: tc.name });
  }

  return NextResponse.json({
    version,
    runs,
    summary: {
      passed: runs.filter((r) => r.status === 'passed').length,
      failed: runs.filter((r) => r.status === 'failed').length,
      error: runs.filter((r) => r.status === 'error').length,
      total: runs.length,
    },
  });
}
