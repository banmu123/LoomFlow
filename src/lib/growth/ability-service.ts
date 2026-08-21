import { supabase } from '@/lib/supabase/server';
import type { AbilityScores, AbilityEngagement, UserAbilityProfile, AbilityScoreHistoryEntry } from './ability-types';
import { emptyScores, emptyEngagement } from './ability-types';

// ===== 能力分数 DB 服务 =====

const STALE_DAYS = 7;

/** 获取用户能力分数缓存 */
export async function getAbilityScores(userId: string): Promise<UserAbilityProfile | null> {
  const { data } = await supabase
    .from('user_ability_scores')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return null;
  return {
    scores: (data.scores as AbilityScores) ?? emptyScores(),
    engagement: (data.engagement as AbilityEngagement) ?? emptyEngagement(),
    role: data.role ?? 'explorer',
    roleLabel: data.role_label ?? '探索者',
    analyzedAt: data.analyzed_at ?? data.created_at,
  };
}

/** 保存用户能力分数（upsert） */
export async function saveAbilityScores(
  userId: string,
  scores: AbilityScores,
  engagement: AbilityEngagement,
  role: string,
  roleLabel: string,
): Promise<void> {
  await supabase.from('user_ability_scores').upsert(
    {
      user_id: userId,
      scores,
      engagement,
      role,
      role_label: roleLabel,
      analyzed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
}

/** 检查缓存是否过期（超过 7 天） */
export async function isStale(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('user_ability_scores')
    .select('analyzed_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data?.analyzed_at) return true;
  const analyzedAt = new Date(data.analyzed_at).getTime();
  const staleMs = STALE_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - analyzedAt > staleMs;
}

/** 保存分数变化历史 */
export async function saveScoreHistory(
  userId: string,
  scores: AbilityScores,
  source: string,
  sourceDetail?: string,
): Promise<void> {
  await supabase.from('ability_score_history').insert({
    user_id: userId,
    scores,
    source,
    source_detail: sourceDetail ?? null,
  });
}

/** 获取分数变化历史 */
export async function getScoreHistory(
  userId: string,
  days: number = 30,
): Promise<AbilityScoreHistoryEntry[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('ability_score_history')
    .select('scores, source, source_detail, created_at')
    .eq('user_id', userId)
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  return (data ?? []).map((d: { scores: unknown; source: string; source_detail: string | null; created_at: string }) => ({
    scores: d.scores as AbilityScores,
    source: d.source,
    sourceDetail: d.source_detail ?? undefined,
    createdAt: d.created_at,
  }));
}
