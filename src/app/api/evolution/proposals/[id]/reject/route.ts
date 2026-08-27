import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { requireEvolutionAccess } from '@/lib/evolution/permissions';

export const runtime = 'nodejs';

// POST /api/evolution/proposals/[id]/reject — 用户拒绝
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { data: proposal } = await supabase
    .from('evolution_proposals')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!proposal) return NextResponse.json({ error: '提案不存在' }, { status: 404 });
  if (proposal.status !== 'pending') return NextResponse.json({ error: '提案已处理' }, { status: 400 });

  const access = await requireEvolutionAccess(proposal.workflow_id, 'proposals:write');
  if (access instanceof Response) return access;

  await supabase
    .from('evolution_proposals')
    .update({ status: 'rejected', rejected_at: new Date().toISOString() })
    .eq('id', id);

  await supabase
    .from('evolution_events')
    .update({ analysis_status: 'rejected', updated_at: new Date().toISOString() })
    .eq('id', proposal.event_id);

  return NextResponse.json({ rejected: true });
}
