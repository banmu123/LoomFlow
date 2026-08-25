import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import {
  ensureWorkflowOwnership,
  listTestCases,
  createTestCase,
} from '@/lib/workflow-copilot/test-case-store';
import type { EvaluationRule } from '@/lib/workflow-copilot/evaluation';

export const runtime = 'nodejs';

// 列出 / 创建测试用例
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });

  const workflowId = request.nextUrl.searchParams.get('workflowId');
  if (!workflowId) return NextResponse.json({ error: 'workflowId 必填' }, { status: 400 });

  const own = await ensureWorkflowOwnership(workflowId, user.id);
  if (!own.ok) return NextResponse.json({ error: own.error }, { status: 403 });

  const cases = await listTestCases(workflowId, user.id);
  return NextResponse.json(cases);
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.workflowId || !body?.name) {
    return NextResponse.json({ error: 'workflowId 与 name 必填' }, { status: 400 });
  }

  const own = await ensureWorkflowOwnership(body.workflowId, user.id);
  if (!own.ok) return NextResponse.json({ error: own.error }, { status: 403 });

  const result = await createTestCase(body.workflowId, user.id, {
    workflowVersion: body.workflowVersion ?? null,
    name: body.name,
    description: body.description,
    inputs: body.inputs ?? {},
    expectedOutputs: body.expectedOutputs,
    evaluationRules: (body.evaluationRules ?? []) as EvaluationRule[],
  });
  if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json(result.testCase, { status: 201 });
}
