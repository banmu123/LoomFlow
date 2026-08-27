import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { requireEvolutionAccess } from '@/lib/evolution/permissions';
import { getWorkflowEval } from '@/lib/workflow-eval/store';
import { detectBottlenecks } from '@/lib/workflow-eval/bottleneck';
import { aggregateNodeMetrics } from '@/lib/workflow-eval/metrics';

export const runtime = 'nodejs';

// GET /api/evolution/health?workflowId=xxx — 工作流健康概览
export async function GET(request: NextRequest) {
  const workflowId = request.nextUrl.searchParams.get('workflowId');
  if (!workflowId) return NextResponse.json({ error: 'workflowId 必填' }, { status: 400 });

  const access = await requireEvolutionAccess(workflowId, 'events:read');
  if (access instanceof Response) return access;

  // 聚合指标
  const evalData = await getWorkflowEval(workflowId, access.result.userId, '7d');
  const nodeResult = aggregateNodeMetrics(evalData.selectedRuns);
  const bottlenecks = detectBottlenecks(evalData.workflow, nodeResult.nodes);

  // 健康分计算（简化版：成功率权重 40% + 延迟权重 30% + 失败率权重 30%）
  const m = evalData.workflow;
  const latencyScore = Math.max(0, 100 - m.p95LatencyMs / 100);
  const healthScore = Math.round(
    m.successRate * 0.4 + latencyScore * 0.3 + (100 - m.failureRate) * 0.3,
  );

  // 趋势（对比 30d）
  const evalData30d = await getWorkflowEval(workflowId, access.result.userId, '30d');
  const m30 = evalData30d.workflow;
  const trend = m.successRate < m30.successRate - 5 || m.p95LatencyMs > m30.p95LatencyMs * 1.2
    ? 'declining'
    : m.successRate > m30.successRate + 5
      ? 'improving'
      : 'stable';

  // pending proposals
  const { count: pendingProposals } = await supabase
    .from('evolution_proposals')
    .select('id', { count: 'exact', head: true })
    .eq('workflow_id', workflowId)
    .eq('status', 'pending');

  // recent events
  const { count: recentEvents } = await supabase
    .from('evolution_events')
    .select('id', { count: 'exact', head: true })
    .eq('workflow_id', workflowId)
    .gte('created_at', new Date(Date.now() - 7 * 24 * 3600_000).toISOString());

  return NextResponse.json({
    workflowId,
    health: {
      score: healthScore,
      trend,
      metrics: {
        successRate: m.successRate,
        latencyP95: m.p95LatencyMs,
        costPerRun: m.estimatedCostPerRun,
        failureRate: m.failureRate,
        totalRuns: m.totalRuns,
      },
      bottlenecks: bottlenecks.bottlenecks,
    },
    pendingProposals: pendingProposals ?? 0,
    recentEvents: recentEvents ?? 0,
  });
}
