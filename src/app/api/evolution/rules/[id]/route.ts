import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { requireEvolutionAccess } from '@/lib/evolution/permissions';

export const runtime = 'nodejs';

// PATCH /api/evolution/rules/[id] — 更新规则
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);

  // 先查规则获取 workflow_id
  const { data: rule } = await supabase
    .from('evolution_rules')
    .select('workflow_id')
    .eq('id', id)
    .maybeSingle();
  if (!rule) return NextResponse.json({ error: '规则不存在' }, { status: 404 });

  const access = await requireEvolutionAccess(rule.workflow_id, 'rules:write');
  if (access instanceof Response) return access;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.enabled !== undefined) patch.enabled = body.enabled;
  if (body.cron_expr !== undefined) patch.cron_expr = body.cron_expr;
  if (body.metric_key !== undefined) patch.metric_key = body.metric_key;
  if (body.metric_op !== undefined) patch.metric_op = body.metric_op;
  if (body.metric_threshold !== undefined) patch.metric_threshold = body.metric_threshold;
  if (body.metric_range !== undefined) patch.metric_range = body.metric_range;
  if (body.baseline_range !== undefined) patch.baseline_range = body.baseline_range;
  if (body.event_type !== undefined) patch.event_type = body.event_type;
  if (body.event_threshold !== undefined) patch.event_threshold = body.event_threshold;
  if (body.cooldown_hours !== undefined) patch.cooldown_hours = body.cooldown_hours;

  const { data, error } = await supabase
    .from('evolution_rules')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE /api/evolution/rules/[id] — 删除规则
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { data: rule } = await supabase
    .from('evolution_rules')
    .select('workflow_id')
    .eq('id', id)
    .maybeSingle();
  if (!rule) return NextResponse.json({ error: '规则不存在' }, { status: 404 });

  const access = await requireEvolutionAccess(rule.workflow_id, 'rules:write');
  if (access instanceof Response) return access;

  const { error } = await supabase.from('evolution_rules').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
