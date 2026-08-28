import { NextRequest, NextResponse } from 'next/server';
import { requireEvolutionAccess } from '@/lib/evolution/permissions';
import { queryEvolutionHistory } from '@/lib/evolution-history/query';
import type { EvolutionAnalysisStatus } from '@/lib/evolution/types';
import type { Severity } from '@/lib/workflow-eval/regression-policy';

export const runtime = 'nodejs';

// GET /api/evolution/history?workflowId=xxx&timeRange=7d&status=applied&severity=high&limit=20&offset=0
export async function GET(request: NextRequest) {
  const workflowId = request.nextUrl.searchParams.get('workflowId');
  if (!workflowId) return NextResponse.json({ error: 'workflowId 必填' }, { status: 400 });

  const access = await requireEvolutionAccess(workflowId, 'events:read');
  if (access instanceof Response) return access;

  const timeRange = request.nextUrl.searchParams.get('timeRange') as '24h' | '7d' | '30d' | 'all' | null;
  const status = request.nextUrl.searchParams.get('status') as EvolutionAnalysisStatus | null;
  const severity = request.nextUrl.searchParams.get('severity') as Severity | null;
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 20);
  const offset = Number(request.nextUrl.searchParams.get('offset') ?? 0);

  const result = await queryEvolutionHistory({
    workflowId,
    timeRange: timeRange ?? 'all',
    status: status ?? undefined,
    severity: severity ?? undefined,
    limit: Math.min(Math.max(1, limit), 100),
    offset: Math.max(0, offset),
  });

  return NextResponse.json(result);
}
