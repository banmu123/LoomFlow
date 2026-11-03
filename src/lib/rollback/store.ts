/* eslint-disable @typescript-eslint/no-explicit-any -- supabase 客户端无数据库类型 */
import { supabase } from '@/lib/supabase/server';
import type { RunRecordLike } from '@/lib/workflow-eval/metrics';
import { DEFAULT_ROLLBACK_POLICY, type RollbackPolicy } from './decision';

export interface StoredRollback {
  id: string;
  workflow_id: string;
  from_version: number | null;
  to_version: number;
  status: string;
  trigger: string | null;
  reason: string | null;
  created_at: string;
  applied_at: string | null;
}

export interface RollbackStore {
  getPolicy(workflowId: string): Promise<RollbackPolicy>;
  getWorkflow(workflowId: string): Promise<{ published: boolean; publishedVersion: number | null } | null>;
  listRuns(workflowId: string, limit: number): Promise<RunRecordLike[]>;
  getPreviousVersion(workflowId: string, currentVersion: number): Promise<number | null>;
  getLastApplied(workflowId: string): Promise<StoredRollback | null>;
  countAutoSince(workflowId: string, sinceIso: string): Promise<number>;
  insertRollback(input: {
    workflowId: string;
    fromVersion: number | null;
    toVersion: number;
    status: 'requested' | 'dry_run';
    trigger: string;
    reason: string;
    metrics: unknown;
    actor: string | null;
    idempotencyKey: string;
  }): Promise<{ id: string; duplicate: boolean }>;
  applyRollback(input: {
    rollbackId: string;
    workflowId: string;
    toVersion: number;
    expectedVersion: number | null;
  }): Promise<{ previousVersion: number | null; publishedVersion: number }>;
  markFailed(rollbackId: string, error: string): Promise<void>;
  markDryRun(rollbackId: string): Promise<void>;
  listHistory(workflowId: string, limit: number): Promise<StoredRollback[]>;
}

function toPolicy(row: any): RollbackPolicy {
  return {
    workflowId: row.workflow_id,
    enabled: Boolean(row.enabled),
    mode: row.mode === 'auto' ? 'auto' : 'manual',
    dryRun: Boolean(row.dry_run),
    minSamples: Number(row.min_samples ?? DEFAULT_ROLLBACK_POLICY.minSamples),
    cooldownMinutes: Number(row.cooldown_minutes ?? DEFAULT_ROLLBACK_POLICY.cooldownMinutes),
    maxAutoRollbacks: Number(row.max_auto_rollbacks ?? DEFAULT_ROLLBACK_POLICY.maxAutoRollbacks),
    maxFailuresStreak: Number(row.max_failures_streak ?? DEFAULT_ROLLBACK_POLICY.maxFailuresStreak),
  };
}

export const supabaseRollbackStore: RollbackStore = {
  async getPolicy(workflowId) {
    const { data } = await (supabase as any)
      .from('rollback_policies')
      .select('*')
      .eq('workflow_id', workflowId)
      .maybeSingle();

    if (!data) {
      return { workflowId, ...DEFAULT_ROLLBACK_POLICY };
    }
    return toPolicy(data);
  },

  async getWorkflow(workflowId) {
    const { data } = await (supabase as any)
      .from('workflow_history')
      .select('published, published_version')
      .eq('id', workflowId)
      .maybeSingle();

    if (!data) return null;
    return {
      published: Boolean(data.published),
      publishedVersion: data.published_version ?? null,
    };
  },

  async listRuns(workflowId, limit) {
    const { data } = await (supabase as any)
      .from('flow_runs')
      .select('id, status, created_at, duration_ms, retry_count, token_usage, cost, trace')
      .eq('workflow_id', workflowId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data ?? []) as RunRecordLike[];
  },

  async getPreviousVersion(workflowId, currentVersion) {
    const { data } = await (supabase as any)
      .from('workflow_versions')
      .select('version')
      .eq('workflow_id', workflowId)
      .lt('version', currentVersion)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.version ?? null;
  },

  async getLastApplied(workflowId) {
    const { data } = await (supabase as any)
      .from('workflow_rollbacks')
      .select('*')
      .eq('workflow_id', workflowId)
      .eq('status', 'applied')
      .order('applied_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as StoredRollback | null) ?? null;
  },

  async countAutoSince(workflowId, sinceIso) {
    const { count } = await (supabase as any)
      .from('workflow_rollbacks')
      .select('id', { count: 'exact', head: true })
      .eq('workflow_id', workflowId)
      .eq('status', 'applied')
      .eq('trigger', 'auto')
      .gte('created_at', sinceIso);
    return count ?? 0;
  },

  async insertRollback(input) {
    const { data, error } = await (supabase as any)
      .from('workflow_rollbacks')
      .insert({
        workflow_id: input.workflowId,
        from_version: input.fromVersion,
        to_version: input.toVersion,
        status: input.status,
        trigger: input.trigger,
        reason: input.reason,
        metrics: input.metrics,
        actor: input.actor,
        idempotency_key: input.idempotencyKey,
      })
      .select('id')
      .single();

    if (!error && data) return { id: data.id, duplicate: false };

    if (error?.code === '23505') {
      const { data: existing } = await (supabase as any)
        .from('workflow_rollbacks')
        .select('id, status')
        .eq('idempotency_key', input.idempotencyKey)
        .maybeSingle();
      if (existing) {
        return { id: existing.id, duplicate: existing.status === 'applied' };
      }
    }

    throw new Error(`回滚记录写入失败：${error?.message ?? 'unknown'}`);
  },

  async applyRollback(input) {
    const { data, error } = await (supabase as any).rpc('loomflow_apply_workflow_rollback', {
      p_workflow_id: input.workflowId,
      p_to_version: input.toVersion,
      p_expected_version: input.expectedVersion,
      p_rollback_id: input.rollbackId,
    });
    if (error) throw new Error(`回滚失败：${error.message}`);
    return {
      previousVersion: data?.previous_version ?? null,
      publishedVersion: data?.published_version ?? input.toVersion,
    };
  },

  async markFailed(rollbackId, error) {
    await (supabase as any)
      .from('workflow_rollbacks')
      .update({ status: 'failed', error: error.slice(0, 1000) })
      .eq('id', rollbackId);
  },

  async markDryRun(rollbackId) {
    await (supabase as any)
      .from('workflow_rollbacks')
      .update({ status: 'dry_run' })
      .eq('id', rollbackId);
  },

  async listHistory(workflowId, limit) {
    const { data } = await (supabase as any)
      .from('workflow_rollbacks')
      .select('*')
      .eq('workflow_id', workflowId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data ?? []) as StoredRollback[];
  },
};
