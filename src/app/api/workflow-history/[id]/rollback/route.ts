import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { supabase } from '@/lib/supabase/server';
import { logAudit, getClientIp } from '@/lib/audit';
import { evaluateRollback, supabaseRollbackStore } from '@/lib/rollback';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

async function loadWorkflow(id: string) {
  const { data } = await supabase
    .from('workflow_history')
    .select('id, user_id, published, published_version')
    .eq('id', id)
    .maybeSingle();
  return data as
    | { id: string; user_id: string | null; published: boolean; published_version: number | null }
    | null;
}

function canManage(user: { id: string; role: string }, workflow: { user_id: string | null }): boolean {
  return user.role === 'admin' || workflow.user_id === user.id;
}

// 回滚策略 + 历史
export async function GET(request: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: '未登录，请先登录' }, { status: 401 });

  const { id } = await params;
  const workflow = await loadWorkflow(id);
  if (!workflow) return Response.json({ error: '工作流不存在' }, { status: 404 });
  if (!canManage(user, workflow)) {
    return Response.json({ error: '无权访问该工作流' }, { status: 403 });
  }

  const policy = await supabaseRollbackStore.getPolicy(id);
  const history = await supabaseRollbackStore.listHistory(id, 20);

  return Response.json({
    policy,
    currentVersion: workflow.published_version,
    published: workflow.published,
    history,
  });
}

// 更新策略（auto 模式仅管理员可开启）
export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: '未登录，请先登录' }, { status: 401 });

  const { id } = await params;
  const workflow = await loadWorkflow(id);
  if (!workflow) return Response.json({ error: '工作流不存在' }, { status: 404 });
  if (!canManage(user, workflow)) {
    return Response.json({ error: '无权操作该工作流' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return Response.json({ error: '请求体必须是 JSON 对象' }, { status: 400 });
  }

  const mode = body.mode === 'auto' ? 'auto' : 'manual';
  if (mode === 'auto' && user.role !== 'admin') {
    return Response.json({ error: '仅管理员可以开启自动回滚' }, { status: 403 });
  }
  if (mode === 'auto' && body.dryRun === true) {
    // 允许，但明确提示：dry run 下 auto 不会真正切换版本
  }

  const clamp = (value: unknown, fallback: number, min: number, max: number): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(Math.trunc(parsed), min), max);
  };

  const row = {
    workflow_id: id,
    enabled: Boolean(body.enabled),
    mode,
    dry_run: body.dryRun === undefined ? true : Boolean(body.dryRun),
    min_samples: clamp(body.minSamples, 20, 5, 5000),
    cooldown_minutes: clamp(body.cooldownMinutes, 60, 5, 1440),
    max_auto_rollbacks: clamp(body.maxAutoRollbacks, 3, 0, 20),
    max_failures_streak: clamp(body.maxFailuresStreak, 5, 2, 100),
    thresholds: body.thresholds && typeof body.thresholds === 'object' ? body.thresholds : {},
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('rollback_policies')
    .upsert(row, { onConflict: 'workflow_id' })
    .select('*')
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  await logAudit({
    userId: user.id,
    username: user.username,
    action: 'rollback_policy_update',
    detail: { workflowId: id, mode, enabled: row.enabled, dryRun: row.dry_run },
    ip: getClientIp(request),
  });

  return Response.json({ policy: data });
}

// 评估 / Dry Run / 执行回滚
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: '未登录，请先登录' }, { status: 401 });

  const { id } = await params;
  const workflow = await loadWorkflow(id);
  if (!workflow) return Response.json({ error: '工作流不存在' }, { status: 404 });
  if (!canManage(user, workflow)) {
    return Response.json({ error: '无权操作该工作流' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const action = body?.action === 'execute' || body?.action === 'auto' ? body.action : 'preview';

  if (action === 'auto' && user.role !== 'admin') {
    return Response.json({ error: '仅管理员可以触发自动回滚' }, { status: 403 });
  }

  const policy = await supabaseRollbackStore.getPolicy(id);
  if (action === 'auto' && policy.mode !== 'auto') {
    return Response.json({ error: '该工作流未启用自动回滚模式' }, { status: 409 });
  }

  const result = await evaluateRollback({
    workflowId: id,
    actorId: user.id,
    execute: action !== 'preview',
    approved: body?.approved === true,
  });

  if (result.executed || result.error) {
    await logAudit({
      userId: user.id,
      username: user.username,
      action: 'workflow_rollback',
      detail: {
        workflowId: id,
        action,
        decision: result.decision.action,
        fromVersion: result.currentVersion,
        toVersion: result.rollback?.toVersion ?? null,
        verified: result.rollback?.verified ?? false,
        error: result.error ?? null,
      },
      ip: getClientIp(request),
    });
  }

  return Response.json(result);
}
