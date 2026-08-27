import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { requireEvolutionAccess } from '@/lib/evolution/permissions';

export const runtime = 'nodejs';

// GET /api/evolution/rules?workflowId=xxx — 列出规则
export async function GET(request: NextRequest) {
  const workflowId = request.nextUrl.searchParams.get('workflowId');
  if (!workflowId) return NextResponse.json({ error: 'workflowId 必填' }, { status: 400 });

  const access = await requireEvolutionAccess(workflowId, 'rules:read');
  if (access instanceof Response) return access;

  const { data } = await supabase
    .from('evolution_rules')
    .select('*')
    .eq('workflow_id', workflowId)
    .order('created_at', { ascending: false });

  return NextResponse.json(data ?? []);
}

// POST /api/evolution/rules — 创建规则
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body?.workflow_id) return NextResponse.json({ error: 'workflow_id 必填' }, { status: 400 });

  const access = await requireEvolutionAccess(body.workflow_id, 'rules:write');
  if (access instanceof Response) return access;

  const { workflow_id, trigger_type, cron_expr, metric_key, metric_op, metric_threshold, metric_range, baseline_range, event_type, event_threshold, cooldown_hours } = body;

  if (!trigger_type) return NextResponse.json({ error: 'trigger_type 必填' }, { status: 400 });

  const { data, error } = await supabase
    .from('evolution_rules')
    .insert({
      workflow_id,
      user_id: access.result.userId,
      trigger_type,
      cron_expr: cron_expr ?? null,
      metric_key: metric_key ?? null,
      metric_op: metric_op ?? null,
      metric_threshold: metric_threshold ?? null,
      metric_range: metric_range ?? '7d',
      baseline_range: baseline_range ?? '30d',
      event_type: event_type ?? null,
      event_threshold: event_threshold ?? null,
      cooldown_hours: cooldown_hours ?? 24,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
