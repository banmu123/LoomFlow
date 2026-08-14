import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/server-auth';
import { clearOSSConfigCache } from '@/lib/oss-config';
import { logAudit, getClientIp } from '@/lib/audit';

// 读取当前 OSS 配置（管理后台「存储设置」，仅 admin）
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'oss_config')
    .maybeSingle();

  return Response.json(data?.value ?? null);
}

// 保存 OSS 配置（仅 admin；写入数据库，无需改环境变量）
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const body = await request.json().catch(() => null);
  const accessKeyId = (body?.accessKeyId || '').trim();
  const accessKeySecret = (body?.accessKeySecret || '').trim();
  const bucket = (body?.bucket || '').trim();
  const region = (body?.region || '').trim();

  if (!accessKeyId || !accessKeySecret || !bucket || !region) {
    return Response.json({ error: 'AccessKey ID、Secret、Bucket、Region 均不能为空' }, { status: 400 });
  }

  const value = {
    accessKeyId,
    accessKeySecret,
    bucket,
    region,
    endpoint: body?.endpoint?.trim() || null,
  };

  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: 'oss_config', value, updated_at: new Date().toISOString() }, { onConflict: 'key' });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  clearOSSConfigCache();
  await logAudit({
    userId: auth.user.id,
    username: auth.user.username,
    action: 'oss_config_update',
    detail: { bucket, region },
    ip: getClientIp(request),
  });

  return Response.json({ success: true });
}

// 清除 OSS 配置（仅 admin）
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const { error } = await supabase.from('app_settings').delete().eq('key', 'oss_config');
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  clearOSSConfigCache();
  await logAudit({
    userId: auth.user.id,
    username: auth.user.username,
    action: 'oss_config_clear',
    detail: {},
    ip: getClientIp(request),
  });

  return Response.json({ success: true });
}
