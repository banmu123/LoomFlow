import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { updateTestCase, deleteTestCase } from '@/lib/workflow-copilot/test-case-store';

export const runtime = 'nodejs';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const result = await updateTestCase(id, user.id, {
    workflowVersion: body.workflowVersion,
    name: body.name,
    description: body.description,
    inputs: body.inputs,
    expectedOutputs: body.expectedOutputs,
    evaluationRules: body.evaluationRules,
  });
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result.testCase);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });

  const { id } = await params;
  const result = await deleteTestCase(id, user.id);
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ deleted: id });
}
