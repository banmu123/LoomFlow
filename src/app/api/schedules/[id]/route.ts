import { NextRequest } from 'next/server';
import { Cron } from 'croner';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';
import { reloadSchedules } from '@/lib/scheduler';
import { isSafeHttpUrl } from '@/lib/url-security';

// 更新定时任务
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);

  const { data: existing } = await supabase
    .from('scheduled_runs')
    .select('id, user_id')
    .eq('id', id)
    .single();

  if (!existing) {
    return Response.json({ error: '定时任务不存在' }, { status: 404 });
  }
  if (existing.user_id !== user.id) {
    return Response.json({ error: '无权操作该任务' }, { status: 403 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.cron_expr === 'string' && body.cron_expr.trim()) {
    try {
      new Cron(body.cron_expr.trim());
    } catch {
      return Response.json({ error: 'cron 表达式无效' }, { status: 400 });
    }
    updates.cron_expr = body.cron_expr.trim();
  }
  if (body.inputs !== undefined) updates.inputs = body.inputs;
  if (typeof body.webhook_url === 'string') {
    // SSRF 防护：webhook_url 必须是安全的公网 http/https 地址
    const webhookUrl = body.webhook_url.trim() || null;
    if (webhookUrl) {
      const check = await isSafeHttpUrl(webhookUrl);
      if (!check.ok) {
        return Response.json(
          { error: `webhook_url 不合法：${check.reason}` },
          { status: 400 },
        );
      }
    }
    updates.webhook_url = webhookUrl;
  }
  if (typeof body.enabled === 'boolean') updates.enabled = body.enabled;

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: '没有可更新的字段' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('scheduled_runs')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  await reloadSchedules();

  return Response.json(data);
}

// 删除定时任务
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const { id } = await params;

  const { data: existing } = await supabase
    .from('scheduled_runs')
    .select('id, user_id')
    .eq('id', id)
    .single();

  if (!existing) {
    return Response.json({ error: '定时任务不存在' }, { status: 404 });
  }
  if (existing.user_id !== user.id) {
    return Response.json({ error: '无权操作该任务' }, { status: 403 });
  }

  const { error } = await supabase.from('scheduled_runs').delete().eq('id', id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  await reloadSchedules();

  return Response.json({ success: true });
}
