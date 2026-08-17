import { NextRequest } from 'next/server';
import { Cron } from 'croner';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';
import { reloadSchedules } from '@/lib/scheduler';
import { isSafeHttpUrl } from '@/lib/url-security';

// 定时任务列表（用户自己的）
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('scheduled_runs')
    .select('*, workflow_history(title)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data);
}

// 创建定时任务
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const workflowId = (body?.workflow_id || '') as string;
  const cronExpr = (body?.cron_expr || '').trim();

  if (!workflowId || !cronExpr) {
    return Response.json({ error: '工作流和 cron 表达式不能为空' }, { status: 400 });
  }

  // 校验 cron 表达式
  try {
    new Cron(cronExpr);
  } catch {
    return Response.json(
      { error: 'cron 表达式无效（格式：分 时 日 月 周，如 */5 * * * *）' },
      { status: 400 },
    );
  }

  // 校验工作流归属
  const { data: wf } = await supabase
    .from('workflow_history')
    .select('id, user_id')
    .eq('id', workflowId)
    .single();

  if (!wf) {
    return Response.json({ error: '工作流不存在' }, { status: 404 });
  }
  if (wf.user_id !== user.id) {
    return Response.json({ error: '无权操作该工作流' }, { status: 403 });
  }

  // SSRF 防护：webhook_url 必须是安全的公网 http/https 地址
  const webhookUrl = body.webhook_url ? String(body.webhook_url).trim() : null;
  if (webhookUrl) {
    const check = await isSafeHttpUrl(webhookUrl);
    if (!check.ok) {
      return Response.json(
        { error: `webhook_url 不合法：${check.reason}` },
        { status: 400 },
      );
    }
  }

  const { data, error } = await supabase
    .from('scheduled_runs')
    .insert({
      workflow_id: workflowId,
      user_id: user.id,
      cron_expr: cronExpr,
      inputs: body.inputs || {},
      webhook_url: webhookUrl,
      enabled: body.enabled !== false,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // 刷新调度器
  await reloadSchedules();

  return Response.json(data, { status: 201 });
}
