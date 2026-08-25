import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { ensureWorkflowOwnership } from '@/lib/workflow-copilot/test-case-store';
import { getWorkflowEval } from '@/lib/workflow-eval/store';
import { aggregateNodeMetrics } from '@/lib/workflow-eval/metrics';
import { detectBottlenecks } from '@/lib/workflow-eval/bottleneck';
import type { EvalRange } from '@/lib/workflow-eval/metrics';

export const runtime = 'nodejs';

const RANGES = new Set(['24h', '7d', '30d']);

// Node Metrics + 瓶颈分析
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
  const { id } = await params;
  const own = await ensureWorkflowOwnership(id, user.id);
  if (!own.ok) return NextResponse.json({ error: own.error }, { status: 403 });

  const range = (request.nextUrl.searchParams.get('range') || '7d') as EvalRange;
  if (!RANGES.has(range)) return NextResponse.json({ error: 'range 非法' }, { status: 400 });

  const evalData = await getWorkflowEval(id, user.id, range);
  const nodeResult = aggregateNodeMetrics(evalData.selectedRuns);
  const bottlenecks = detectBottlenecks(evalData.workflow, nodeResult.nodes);

  return NextResponse.json({
    workflowId: id,
    range,
    nodes: nodeResult.nodes,
    slowest: nodeResult.slowest,
    mostExpensive: nodeResult.mostExpensive,
    mostFailureProne: nodeResult.mostFailureProne,
    bottlenecks,
  });
}