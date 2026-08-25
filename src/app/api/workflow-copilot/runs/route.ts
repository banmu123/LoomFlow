import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import {
  ensureWorkflowOwnership,
  listTestRuns,
} from '@/lib/workflow-copilot/test-case-store';

export const runtime = 'nodejs';

// 测试运行结果历史
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });

  const workflowId = request.nextUrl.searchParams.get('workflowId');
  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') || 30), 100);
  if (!workflowId) return NextResponse.json({ error: 'workflowId 必填' }, { status: 400 });

  const own = await ensureWorkflowOwnership(workflowId, user.id);
  if (!own.ok) return NextResponse.json({ error: own.error }, { status: 403 });

  const runs = await listTestRuns(workflowId, limit);
  return NextResponse.json(runs);
}
