import { supabase } from '@/lib/supabase/server';
import type { Practice } from './types';
import { validatePracticeInput, isValidPracticeStatus } from './types';

// ===== Practice CRUD（仅本人）=====

export async function listPractices(
  userId: string,
  capabilityId?: string,
): Promise<Practice[]> {
  let query = supabase
    .from('practices')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (capabilityId) {
    query = query.eq('capability_id', capabilityId);
  }
  const { data } = await query;
  return (data ?? []) as Practice[];
}

export async function getPractice(
  practiceId: string,
  userId: string,
): Promise<Practice | null> {
  const { data } = await supabase
    .from('practices')
    .select('*')
    .eq('id', practiceId)
    .eq('user_id', userId)
    .maybeSingle();
  return (data as Practice | null) ?? null;
}

export async function createPractice(
  userId: string,
  input: {
    title?: unknown;
    description?: unknown;
    type?: unknown;
    difficulty?: unknown;
    instructions?: unknown;
    capability_id?: unknown;
  },
): Promise<{ error?: string; practice?: Practice }> {
  const v = validatePracticeInput(input);
  if (v.error) return { error: v.error };

  const { data, error } = await supabase
    .from('practices')
    .insert({
      user_id: userId,
      capability_id: v.capability_id,
      type: v.type,
      title: v.title,
      description: v.description,
      difficulty: v.difficulty,
      instructions: v.instructions,
    })
    .select()
    .single();
  if (error || !data) return { error: error?.message || '创建失败' };
  return { practice: data as Practice };
}

export async function updatePractice(
  practiceId: string,
  userId: string,
  patch: {
    title?: unknown;
    description?: unknown;
    type?: unknown;
    difficulty?: unknown;
    instructions?: unknown;
    status?: unknown;
  },
): Promise<{ error?: string; practice?: Practice }> {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (patch.title !== undefined) {
    const title = String(patch.title ?? '').trim();
    if (!title) return { error: '练习标题不能为空' };
    updates.title = title;
  }
  if (patch.description !== undefined) {
    updates.description =
      typeof patch.description === 'string' && patch.description.trim()
        ? patch.description.trim()
        : null;
  }
  if (patch.type !== undefined) {
    const t = String(patch.type);
    if (!['code', 'workflow', 'project', 'reflection'].includes(t))
      return { error: '练习类型不合法' };
    updates.type = t;
  }
  if (patch.difficulty !== undefined) {
    const d = String(patch.difficulty);
    if (!['beginner', 'intermediate', 'advanced'].includes(d))
      return { error: '难度不合法' };
    updates.difficulty = d;
  }
  if (patch.instructions !== undefined) {
    updates.instructions = String(patch.instructions ?? '');
  }
  if (patch.status !== undefined) {
    if (!isValidPracticeStatus(String(patch.status))) return { error: '状态不合法' };
    updates.status = String(patch.status);
    if (String(patch.status) === 'completed') {
      updates.completed_at = new Date().toISOString();
    }
  }

  if (Object.keys(updates).length === 1) return { error: '没有可更新的字段' };

  const { data, error } = await supabase
    .from('practices')
    .update(updates)
    .eq('id', practiceId)
    .eq('user_id', userId)
    .select()
    .single();
  if (error || !data) return { error: error?.message || '更新失败' };
  return { practice: data as Practice };
}

export async function deletePractice(
  practiceId: string,
  userId: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('practices')
    .delete()
    .eq('id', practiceId)
    .eq('user_id', userId);
  if (error) return { error: error.message };
  return {};
}

/** 标记练习完成 → 更新 practice 状态 + 返回完成信息（调用方负责产生 Evidence） */
export async function completePractice(
  practiceId: string,
  userId: string,
): Promise<{ error?: string; practice?: Practice }> {
  const practice = await getPractice(practiceId, userId);
  if (!practice) return { error: '练习不存在或无权访问' };
  if (practice.status === 'completed') return { error: '练习已完成' };

  const { data, error } = await supabase
    .from('practices')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', practiceId)
    .eq('user_id', userId)
    .select()
    .single();
  if (error || !data) return { error: error?.message || '完成失败' };
  return { practice: data as Practice };
}
