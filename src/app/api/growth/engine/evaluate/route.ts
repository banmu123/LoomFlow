import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';
import { collectEvidence } from '@/lib/growth/evidence';
import { evaluateJourneyCapabilities, applyCapabilityStatus } from '@/lib/growth/engine';
import type { Capability } from '@/lib/growth/types';

export const runtime = 'nodejs';

// ===== Growth Engine 评估端点 =====
// POST /api/growth/engine/evaluate  { journeyId }
// 收集真实行为证据 → 评估 Journey 全部 Capability → 统一应用状态变更
// 返回：证据摘要 + 变更列表（前端可展示"为什么状态变化"）

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const journeyId = (body?.journeyId || '').trim();
  if (!journeyId) {
    return Response.json({ error: '缺少 journeyId' }, { status: 400 });
  }

  // 归属校验
  const { data: journey } = await supabase
    .from('journeys')
    .select('id')
    .eq('id', journeyId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!journey) {
    return Response.json({ error: '路径不存在或无权访问' }, { status: 403 });
  }

  const { data: caps } = await supabase
    .from('journey_capabilities')
    .select('*')
    .eq('journey_id', journeyId)
    .eq('user_id', user.id)
    .order('order', { ascending: true });
  const capabilities = (caps ?? []) as Capability[];

  // 收集证据（从现有系统真实行为）
  const evidence = await collectEvidence(user.id);

  // 评估 + 统一应用（Growth Engine 唯一写入口）
  const changes = evaluateJourneyCapabilities(capabilities, evidence);
  let applied = 0;
  for (const c of changes) {
    const { error } = await applyCapabilityStatus(c.capabilityId, user.id, c.to);
    if (!error) applied++;
  }

  return Response.json({
    evidence,
    changes,
    applied,
    note: '状态由真实行为证据自动评估（workflow/运行/发布/定时/笔记），非 AI 主观判断',
  });
}
