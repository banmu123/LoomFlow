import { supabase } from '@/lib/supabase/server';
import type {
  Capability,
  Goal,
  Journey,
} from './types';
import {
  validateGoalInput,
  validateJourneyInput,
  isValidGoalStatus,
  isValidJourneyStatus,
  isValidCapabilityStatus,
} from './types';

// ===== Goal CRUD（仅本人）=====

export async function listGoals(userId: string): Promise<Goal[]> {
  const { data } = await supabase
    .from('goals')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return (data ?? []) as Goal[];
}

export async function getGoal(goalId: string, userId: string): Promise<Goal | null> {
  const { data } = await supabase
    .from('goals')
    .select('*')
    .eq('id', goalId)
    .eq('user_id', userId)
    .maybeSingle();
  return (data as Goal | null) ?? null;
}

export async function createGoal(
  userId: string,
  input: { title?: unknown; description?: unknown; status?: unknown },
): Promise<{ error?: string; goal?: Goal }> {
  const v = validateGoalInput(input);
  if (v.error) return { error: v.error };
  const status = isValidGoalStatus(String(input.status ?? 'active'))
    ? String(input.status)
    : 'active';
  const { data, error } = await supabase
    .from('goals')
    .insert({ user_id: userId, title: v.title, description: v.description, status })
    .select()
    .single();
  if (error || !data) return { error: error?.message || '创建失败' };
  return { goal: data as Goal };
}

export async function updateGoal(
  goalId: string,
  userId: string,
  patch: { title?: unknown; description?: unknown; status?: unknown },
): Promise<{ error?: string; goal?: Goal }> {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined || patch.description !== undefined) {
    const v = validateGoalInput({
      title: patch.title ?? '',
      description: patch.description,
    });
    if (patch.title !== undefined && v.error) return { error: v.error };
    if (patch.title !== undefined) updates.title = v.title;
    if (patch.description !== undefined) updates.description = v.description;
  }
  if (patch.status !== undefined) {
    if (!isValidGoalStatus(String(patch.status))) return { error: '状态不合法' };
    updates.status = patch.status;
  }
  if (Object.keys(updates).length === 1) return { error: '没有可更新的字段' };

  const { data, error } = await supabase
    .from('goals')
    .update(updates)
    .eq('id', goalId)
    .eq('user_id', userId)
    .select()
    .single();
  if (error || !data) return { error: error?.message || '更新失败' };
  return { goal: data as Goal };
}

export async function deleteGoal(goalId: string, userId: string): Promise<{ error?: string }> {
  // journeys 与 capabilities 级联删除
  const { error } = await supabase
    .from('goals')
    .delete()
    .eq('id', goalId)
    .eq('user_id', userId);
  if (error) return { error: error.message };
  return {};
}

// ===== Journey CRUD + Capabilities 一体（仅本人）=====

export async function listJourneys(
  goalId: string,
  userId: string,
): Promise<Array<Journey & { capabilities: Capability[] }>> {
  const { data: journeys } = await supabase
    .from('journeys')
    .select('*')
    .eq('goal_id', goalId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  const rows = (journeys ?? []) as Journey[];
  const withCaps = await Promise.all(
    rows.map(async (j) => ({
      ...j,
      capabilities: await listCapabilities(j.id, userId),
    })),
  );
  return withCaps;
}

export async function listCapabilities(journeyId: string, userId: string): Promise<Capability[]> {
  const { data } = await supabase
    .from('journey_capabilities')
    .select('*')
    .eq('journey_id', journeyId)
    .eq('user_id', userId)
    .order('order', { ascending: true });
  return (data ?? []) as Capability[];
}

export async function createJourney(
  goalId: string,
  userId: string,
  input: {
    title?: unknown;
    description?: unknown;
    capabilities?: Array<{
      title?: unknown;
      description?: unknown;
      prerequisites?: unknown;
    }>;
  },
): Promise<{ error?: string; journey?: Journey & { capabilities: Capability[] } }> {
  const v = validateJourneyInput(input);
  if (v.error) return { error: v.error };

  // 目标归属校验
  const goal = await getGoal(goalId, userId);
  if (!goal) return { error: '目标不存在或无权访问' };

  const { data, error } = await supabase
    .from('journeys')
    .insert({ goal_id: goalId, user_id: userId, title: v.title, description: v.description })
    .select()
    .single();
  if (error || !data) return { error: error?.message || '创建失败' };
  const journey = data as Journey;

  // 阶段（capabilities）可选一并创建
  const caps = Array.isArray(input.capabilities) ? input.capabilities : [];
  const created: Capability[] = [];
  for (let i = 0; i < caps.length; i++) {
    const c = caps[i];
    const title = typeof c.title === 'string' && c.title.trim() ? c.title.trim() : `阶段 ${i + 1}`;
    const description =
      typeof c.description === 'string' && c.description.trim() ? c.description.trim() : null;
    const prerequisites = Array.isArray(c.prerequisites)
      ? c.prerequisites.map(String)
      : [];
    const { data: capData } = await supabase
      .from('journey_capabilities')
      .insert({
        journey_id: journey.id,
        user_id: userId,
        title,
        description,
        order: i,
        prerequisites,
      })
      .select()
      .single();
    if (capData) created.push(capData as Capability);
  }

  return { journey: { ...journey, capabilities: created } };
}

export async function replaceJourneyCapabilities(
  journeyId: string,
  userId: string,
  capabilities: Array<{
    title?: unknown;
    description?: unknown;
    prerequisites?: unknown;
    status?: unknown;
  }>,
): Promise<{ error?: string; capabilities?: Capability[] }> {
  if (!Array.isArray(capabilities)) return { error: 'capabilities 必须是数组' };

  // 归属校验（journey 存在且属于本人）
  const { data: journey } = await supabase
    .from('journeys')
    .select('id')
    .eq('id', journeyId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!journey) return { error: '路径不存在或无权访问' };

  // 删除旧阶段后重建（简单可靠；阶段 id 会变化——MVP 可接受）
  await supabase.from('journey_capabilities').delete().eq('journey_id', journeyId);

  const created: Capability[] = [];
  for (let i = 0; i < capabilities.length; i++) {
    const c = capabilities[i];
    const title = typeof c.title === 'string' && c.title.trim() ? c.title.trim() : `阶段 ${i + 1}`;
    const description =
      typeof c.description === 'string' && c.description.trim() ? c.description.trim() : null;
    const status = isValidCapabilityStatus(String(c.status ?? 'locked')) ? String(c.status) : 'locked';
    const { data: capData } = await supabase
      .from('journey_capabilities')
      .insert({
        journey_id: journeyId,
        user_id: userId,
        title,
        description,
        order: i,
        status,
        prerequisites: Array.isArray(c.prerequisites) ? c.prerequisites.map(String) : [],
      })
      .select()
      .single();
    if (capData) created.push(capData as Capability);
  }
  return { capabilities: created };
}

export async function updateJourney(
  journeyId: string,
  userId: string,
  patch: { title?: unknown; description?: unknown; status?: unknown },
): Promise<{ error?: string; journey?: Journey }> {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) {
    const v = validateJourneyInput({ title: patch.title, description: patch.description });
    if (v.error) return { error: v.error };
    updates.title = v.title;
    if (v.description !== undefined) updates.description = v.description;
  } else if (patch.description !== undefined) {
    const v = validateJourneyInput({ title: 'x', description: patch.description });
    updates.description = v.description;
  }
  if (patch.status !== undefined) {
    if (!isValidJourneyStatus(String(patch.status))) return { error: '状态不合法' };
    updates.status = patch.status;
  }
  if (Object.keys(updates).length === 1) return { error: '没有可更新的字段' };

  const { data, error } = await supabase
    .from('journeys')
    .update(updates)
    .eq('id', journeyId)
    .eq('user_id', userId)
    .select()
    .single();
  if (error || !data) return { error: error?.message || '更新失败' };
  return { journey: data as Journey };
}

export async function deleteJourney(journeyId: string, userId: string): Promise<{ error?: string }> {
  // capabilities 级联删除
  const { error } = await supabase
    .from('journeys')
    .delete()
    .eq('id', journeyId)
    .eq('user_id', userId);
  if (error) return { error: error.message };
  return {};
}

/** 更新单个 Capability 状态/标题等 */
export async function updateCapability(
  capabilityId: string,
  userId: string,
  patch: { title?: unknown; status?: unknown; description?: unknown },
): Promise<{ error?: string; capability?: Capability }> {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) {
    const title = String(patch.title ?? '').trim();
    if (!title) return { error: '阶段标题不能为空' };
    updates.title = title;
  }
  if (patch.description !== undefined) {
    updates.description =
      typeof patch.description === 'string' && patch.description.trim()
        ? patch.description.trim()
        : null;
  }
  if (patch.status !== undefined) {
    if (!isValidCapabilityStatus(String(patch.status))) return { error: '状态不合法' };
    updates.status = patch.status;
  }
  if (Object.keys(updates).length === 1) return { error: '没有可更新的字段' };

  const { data, error } = await supabase
    .from('journey_capabilities')
    .update(updates)
    .eq('id', capabilityId)
    .eq('user_id', userId)
    .select()
    .single();
  if (error || !data) return { error: error?.message || '更新失败' };
  return { capability: data as Capability };
}
