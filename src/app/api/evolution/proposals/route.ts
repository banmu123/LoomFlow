import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { requireEvolutionAccess } from '@/lib/evolution/permissions';

export const runtime = 'nodejs';

// GET /api/evolution/proposals?workflowId=xxx&status=pending
export async function GET(request: NextRequest) {
  const workflowId = request.nextUrl.searchParams.get('workflowId');
  if (!workflowId) return NextResponse.json({ error: 'workflowId 必填' }, { status: 400 });

  const access = await requireEvolutionAccess(workflowId, 'proposals:read');
  if (access instanceof Response) return access;

  const status = request.nextUrl.searchParams.get('status');

  let query = supabase
    .from('evolution_proposals')
    .select('*')
    .eq('workflow_id', workflowId)
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data } = await query;
  return NextResponse.json(data ?? []);
}
