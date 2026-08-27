import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { requireEvolutionAccess } from '@/lib/evolution/permissions';

export const runtime = 'nodejs';

// GET /api/evolution/events?workflowId=xxx&type=trigger_fired&limit=50
export async function GET(request: NextRequest) {
  const workflowId = request.nextUrl.searchParams.get('workflowId');
  if (!workflowId) return NextResponse.json({ error: 'workflowId 必填' }, { status: 400 });

  const access = await requireEvolutionAccess(workflowId, 'events:read');
  if (access instanceof Response) return access;

  const type = request.nextUrl.searchParams.get('type');
  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') ?? 50), 200);

  let query = supabase
    .from('evolution_events')
    .select('*')
    .eq('workflow_id', workflowId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (type) query = query.eq('analysis_status', type);

  const { data } = await query;
  return NextResponse.json(data ?? []);
}
