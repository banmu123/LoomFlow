import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { supabase } from '@/lib/supabase/server';
import { hashApiKey } from '@/lib/api-key';
import { decryptSecret } from '@/lib/secrets';
import { getSkill, saveSkillRun } from '@/lib/workflow-skill/skill-store';
import { resolveSkillWorkflow, checkRateLimit } from '@/lib/workflow-skill/skill-resolver';
import { resolveSkillInputs, uiFormSchema } from '@/lib/workflow-skill/skill-schema';
import { executeSkillWorkflow } from '@/lib/workflow-skill/skill-runtime';

export const runtime = 'nodejs';

/** API Key 鉴权 → 返回 userId 或 error */
async function resolveApiKeyUser(authHeader: string | null): Promise<{ userId?: string; error?: { message: string; status: number } }> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: { message: '缺少 API Key（Authorization: Bearer <key>）', status: 401 } };
  }
  const apiKey = authHeader.slice(7).trim();
  if (!apiKey) return { error: { message: '缺少 API Key', status: 401 } };

  const keyHash = hashApiKey(apiKey);
  const { data: hit } = (await supabase
    .from('user_api_keys')
    .select('user_id, api_key_expires_at, api_key')
    .eq('api_key_hash', keyHash)
    .maybeSingle()) as { data: { user_id: string; api_key_expires_at: string | null; api_key: string | null } | null };
  let userId = hit ? (decryptSecret(String(hit.api_key ?? '')) === apiKey ? hit.user_id : undefined) : undefined;

  if (!userId) {
    const { data: legacy } = (await supabase
      .from('user_api_keys')
      .select('user_id, api_key_expires_at, api_key')
      .eq('api_key', apiKey)
      .maybeSingle()) as { data: { user_id: string; api_key_expires_at: string | null; api_key: string | null } | null };
    userId = legacy?.user_id;
  }

  if (!userId) return { error: { message: 'API Key 无效', status: 401 } };
  return { userId };
}

/**
 * 执行 Skill
 * - 会话登录（Web UI）或 Bearer API Key（外部）均支持
 * - 支持 version / timeout / rate limit
 * - 复用 FlowEngine（Skill Resolver → Workflow Version → FlowEngine）
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const inputs = (body?.inputs ?? {}) as Record<string, unknown>;

  // 鉴权：优先会话，其次 API Key
  const sessionUser = await getCurrentUser();
  let userId = sessionUser?.id;
  if (!userId) {
    const keyAuth = await resolveApiKeyUser(request.headers.get('authorization'));
    if (keyAuth.error) return NextResponse.json({ error: keyAuth.error.message }, { status: keyAuth.error.status });
    userId = keyAuth.userId;
  }

  const { skill: skillOpt, error } = await getSkill(id, userId!);
  if (error) return NextResponse.json({ error }, { status: 404 });
  const skill = skillOpt!;

  // 会话执行非发布态；API 执行要求 published
  const viaApi = !sessionUser;
  if (viaApi && skill.status !== 'published') {
    return NextResponse.json({ error: 'Skill 未发布，无法通过 API 调用' }, { status: 403 });
  }

  // 限流（API 场景）
  const policy = skill.executionPolicy;
  if (viaApi && policy.rateLimitPerMin && policy.rateLimitPerMin > 0) {
    const rl = checkRateLimit(`skill:${id}:${userId}`, policy.rateLimitPerMin);
    if (rl.limited) {
      return NextResponse.json(
        { error: '请求过于频繁，请稍后再试', rateLimit: { resetAtMs: rl.resetAtMs } },
        { status: 429 },
      );
    }
  }

  // 版本覆盖：body.version ?? skill.workflowVersion
  const targetVersion = body?.version ?? skill.workflowVersion;

  // 解析工作流（发布快照或指定版本）
  const { resolved, error: resolveErr } = await resolveSkillWorkflow(
    skill.workflowId,
    targetVersion,
    userId!,
  );
  if (resolveErr || !resolved) {
    return NextResponse.json({ error: resolveErr ?? '无法解析工作流' }, { status: 400 });
  }

  // 校验输入按 skill input schema
  const { ok, resolved: cleanInputs, errors: inputErrors } = resolveSkillInputs(inputs, skill.definition.inputs);
  if (!ok) return NextResponse.json({ error: `输入校验失败: ${inputErrors.join('；')}` }, { status: 400 });

  // 执行（复用 FlowEngine；timeout 来自执行策略）
  const result = await executeSkillWorkflow(resolved.data, {
    skillId: id,
    skillVersion: skill.version,
    workflowVersion: resolved.workflowVersion,
    inputs: cleanInputs,
    timeoutMs: policy.timeoutMs ?? 60_000,
    maxConcurrency: policy.maxConcurrency ?? 1,
  });

  // 落库运行日志
  await saveSkillRun({
    runId: result.runId,
    skillId: id,
    skillVersion: skill.version,
    workflowVersion: resolved.workflowVersion,
    inputs: cleanInputs,
    status: result.status,
    outputs: result.outputs,
    error: result.error,
    durationMs: result.durationMs,
    tokenUsage: result.tokenUsage,
    estimatedCost: result.estimatedCost,
    retryCount: (result.trace as { retryCount?: number } | undefined)?.retryCount,
    trace: result.trace,
  });

  const statusCode = result.status === 'failed' ? 500 : result.status === 'timeout' ? 504 : 200;
  return NextResponse.json(
    {
      runId: result.runId,
      skillId: id,
      status: result.status,
      outputs: result.outputs,
      error: result.error,
      durationMs: result.durationMs,
      tokenUsage: result.tokenUsage,
      estimatedCost: result.estimatedCost,
      workflowVersion: resolved.workflowVersion,
    },
    { status: statusCode },
  );
}

// uiFormSchema 导出供前端渲染输入表单（可选引入）
export { uiFormSchema };
