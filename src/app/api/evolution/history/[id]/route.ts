import { NextRequest, NextResponse } from 'next/server';
import { requireEvolutionAccess } from '@/lib/evolution/permissions';
import { getEvolutionHistoryRecord } from '@/lib/evolution-history/query';

export const runtime = 'nodejs';

// GET /api/evolution/history/[id]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const record = await getEvolutionHistoryRecord(id);
  if (!record) {
    return NextResponse.json({ error: '记录不存在' }, { status: 404 });
  }

  const access = await requireEvolutionAccess(record.workflowId, 'events:read');
  if (access instanceof Response) return access;

  return NextResponse.json(record);
}
