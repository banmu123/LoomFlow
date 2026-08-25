import { supabase } from '@/lib/supabase/server';
import type { SkillDefinitionV1, SkillPublic } from './skill-types';

export interface SkillRow {
  id: string;
  userId: string;
  workflowId: string;
  workflowVersion: number | null;
  title: string;
  definition: SkillDefinitionV1;
  executionPolicy: SkillPublic['executionPolicy'];
  evaluationRules: Array<Record<string, unknown>> | null;
  publishedTargets: SkillPublic['publishedTargets'];
  status: SkillPublic['status'];
  version: number;
  createdAt: string;
  updatedAt: string;
}

function toRow(r: Record<string, unknown>, userIdTag: string): SkillRow {
  const def = (r.definition ?? {}) as Partial<SkillDefinitionV1>;
  return {
    id: String(r.id),
    userId: userIdTag,
    workflowId: String(r.workflow_id),
    workflowVersion: r.workflow_version as number | null,
    title: String(r.title),
    definition: {
      schemaVersion: 1,
      name: def.name ?? String(r.title),
      description: def.description ?? '',
      inputs: def.inputs ?? { fields: [] },
      outputs: def.outputs ?? { fields: [] },
      examples: def.examples ?? [],
      usageInstructions: def.usageInstructions,
      constraints: def.constraints,
    },
    executionPolicy: (r.execution_policy as SkillPublic['executionPolicy']) ?? { timeoutMs: 60_000 },
    evaluationRules: (r.evaluation_rules ?? null) as Array<Record<string, unknown>> | null,
    publishedTargets: (r.published_targets as SkillPublic['publishedTargets']) ?? { webUi: true, api: false, share: false },
    status: (r.status as SkillPublic['status']) ?? 'draft',
    version: Number(r.version ?? 1),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

/** 校验工作流归属 */
export async function ensureWorkflowOwnership(
  workflowId: string,
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data } = await supabase
    .from('workflow_history')
    .select('id')
    .eq('id', workflowId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return { ok: false, error: '工作流不存在或无权访问' };
  return { ok: true };
}

/** 列出我的 Skills */
export async function listSkills(userId: string): Promise<SkillRow[]> {
  const { data } = await supabase
    .from('skills')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => toRow(r, userId));
}

/** 获取单个 Skill（校验归属） */
export async function getSkill(
  skillId: string,
  userId: string,
): Promise<{ skill?: SkillRow; error?: string }> {
  const { data } = await supabase
    .from('skills')
    .select('*')
    .eq('id', skillId)
    .maybeSingle();
  if (!data) return { error: 'Skill 不存在' };
  if (data.user_id !== userId) return { error: '无权访问该 Skill' };
  return { skill: toRow(data, userId) };
}

/** 创建 Skill */
export async function createSkill(
  userId: string,
  input: {
    workflowId: string;
    workflowVersion?: number | null;
    title?: string;
    definition: SkillDefinitionV1;
    executionPolicy?: SkillPublic['executionPolicy'];
    evaluationRules?: Array<Record<string, unknown>>;
  },
): Promise<{ skill?: SkillRow; error?: string }> {
  const { data, error } = await supabase
    .from('skills')
    .insert({
      user_id: userId,
      workflow_id: input.workflowId,
      workflow_version: input.workflowVersion ?? null,
      title: input.title ?? input.definition.name,
      definition: input.definition,
      execution_policy: input.executionPolicy ?? { timeoutMs: 60_000 },
      evaluation_rules: input.evaluationRules ?? [],
      published_targets: { webUi: true, api: false, share: false },
      status: 'draft',
      version: 1,
    })
    .select('*')
    .single();
  if (error) return { error: error.message };
  return { skill: toRow(data, userId) };
}

/** 更新 Skill（校验归属）；改写 definition 时 version 递增并记录快照 */
export async function updateSkill(
  skillId: string,
  userId: string,
  updates: Partial<{
    title: string;
    definition: SkillDefinitionV1;
    executionPolicy: SkillPublic['executionPolicy'];
    evaluationRules: Array<Record<string, unknown>>;
    workflowId: string;
    workflowVersion: number | null;
    publishedTargets: SkillPublic['publishedTargets'];
    status: SkillPublic['status'];
  }>,
): Promise<{ skill?: SkillRow; error?: string }> {
  const { data: owner } = await supabase
    .from('skills')
    .select('user_id, workflow_id, workflow_version, definition, version')
    .eq('id', skillId)
    .maybeSingle();
  if (!owner) return { error: 'Skill 不存在' };
  if (owner.user_id !== userId) return { error: '无权操作该 Skill' };

  // 检测「行为变更」（definition / 绑定工作流变化）→ 递增 version 并记录历史
  const behaviorChanged =
    updates.definition !== undefined ||
    updates.workflowId !== undefined ||
    updates.workflowVersion !== undefined;

  const currentVersion = Number(owner.version ?? 1);
  const nextVersion = behaviorChanged ? currentVersion + 1 : currentVersion;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.title !== undefined) patch.title = updates.title;
  if (updates.definition !== undefined) patch.definition = updates.definition;
  if (updates.executionPolicy !== undefined) patch.execution_policy = updates.executionPolicy;
  if (updates.evaluationRules !== undefined) patch.evaluation_rules = updates.evaluationRules;
  if (updates.workflowId !== undefined) patch.workflow_id = updates.workflowId;
  if (updates.workflowVersion !== undefined) patch.workflow_version = updates.workflowVersion;
  if (updates.publishedTargets !== undefined) patch.published_targets = updates.publishedTargets;
  if (updates.status !== undefined) patch.status = updates.status;
  if (behaviorChanged) patch.version = nextVersion;

  const { data, error } = await supabase
    .from('skills')
    .update(patch)
    .eq('id', skillId)
    .select('*')
    .single();
  if (error) return { error: error.message };

  // 行为变更时写入 skill_versions 快照
  if (behaviorChanged) {
    await supabase.from('skill_versions').insert({
      skill_id: skillId,
      version: nextVersion,
      workflow_id: (updates.workflowId ?? owner.workflow_id) as string,
      workflow_version:
        updates.workflowVersion !== undefined
          ? updates.workflowVersion
          : (owner.workflow_version as number | null),
      title: updates.title ?? String((data as Record<string, unknown>).title),
      definition: (updates.definition ?? owner.definition) as SkillDefinitionV1,
      evaluation_rules: updates.evaluationRules
        ? updates.evaluationRules
        : (owner.evaluation_rules as Array<Record<string, unknown>> | null),
      status: updates.status === 'published' ? 'published' : 'candidate',
    });
  }

  return { skill: toRow(data, userId) };
}

/** 归档 / 恢复 */
export async function setSkillStatus(
  skillId: string,
  userId: string,
  status: SkillPublic['status'],
): Promise<{ skill?: SkillRow; error?: string }> {
  return updateSkill(skillId, userId, { status });
}

/** 删除 Skill */
export async function deleteSkill(
  skillId: string,
  userId: string,
): Promise<{ error?: string }> {
  const { data: owner } = await supabase
    .from('skills')
    .select('user_id')
    .eq('id', skillId)
    .maybeSingle();
  if (!owner) return { error: 'Skill 不存在' };
  if (owner.user_id !== userId) return { error: '无权操作该 Skill' };
  const { error } = await supabase.from('skills').delete().eq('id', skillId);
  if (error) return { error: error.message };
  return {};
}

/** Skill 版本历史 */
export async function listSkillVersions(
  skillId: string,
  userId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data: owner } = await supabase.from('skills').select('user_id').eq('id', skillId).maybeSingle();
  if (!owner || owner.user_id !== userId) return [];
  const { data } = await supabase
    .from('skill_versions')
    .select('*')
    .eq('skill_id', skillId)
    .order('version', { ascending: false });
  return data ?? [];
}

/** 记录一次 Skill 运行 */
export async function saveSkillRun(run: {
  runId: string;
  skillId: string;
  skillVersion: number | null;
  workflowVersion: number | null;
  inputs: Record<string, unknown>;
  status: string;
  outputs?: Record<string, unknown> | null;
  error?: string | null;
  durationMs: number;
  tokenUsage: number;
  estimatedCost: number;
  rateLimited?: boolean;
  retryCount?: number;
  trace?: unknown;
}): Promise<void> {
  await supabase.from('skill_runs').insert({
    id: run.runId,
    skill_id: run.skillId,
    skill_version: run.skillVersion,
    workflow_version: run.workflowVersion,
    inputs: run.inputs,
    status: run.status,
    outputs: run.outputs ?? null,
    error: run.error ?? null,
    duration_ms: run.durationMs,
    token_usage: run.tokenUsage,
    estimated_cost: run.estimatedCost,
    rate_limited: run.rateLimited ?? false,
    retry_count: run.retryCount ?? 0,
    trace: run.trace ?? null,
  });
}

/** Skill 运行历史 */
export async function listSkillRuns(
  skillId: string,
  userId: string,
  limit = 50,
): Promise<Array<Record<string, unknown>>> {
  const { data: owner } = await supabase.from('skills').select('user_id').eq('id', skillId).maybeSingle();
  if (!owner || owner.user_id !== userId) return [];
  const { data } = await supabase
    .from('skill_runs')
    .select('*')
    .eq('skill_id', skillId)
    .order('ran_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}

/** 用于计算的运行指标原始数据 */
export async function fetchSkillMetricsData(
  skillId: string,
  userId: string,
): Promise<{ total: number; success: number; error: number; durations: number[]; tokens: number[]; costs: number[] }> {
  void userId;
  const { data } = await supabase
    .from('skill_runs')
    .select('status, duration_ms, token_usage, estimated_cost')
    .eq('skill_id', skillId);
  if (!data) return { total: 0, success: 0, error: 0, durations: [], tokens: [], costs: [] };
  const rows = (data ?? []) as Array<{ status: string; duration_ms: number | null; token_usage: number | null; estimated_cost: number | null }>;
  return {
    total: rows.length,
    success: rows.filter((r) => r.status === 'completed').length,
    error: rows.filter((r) => r.status === 'failed' || r.status === 'timeout').length,
    durations: rows.map((r) => Number(r.duration_ms ?? 0)),
    tokens: rows.map((r) => Number(r.token_usage ?? 0)),
    costs: rows.map((r) => Number(r.estimated_cost ?? 0)),
  };
}
