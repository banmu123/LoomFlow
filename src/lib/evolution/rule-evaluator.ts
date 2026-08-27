/**
 * Evolution Engine — Rule Evaluator
 *
 * 纯判断：一条规则是否应该触发。
 * 检查项：enabled / cooldown / 最小执行数 / 重复 proposal 防重
 *
 * 不做的事：不执行触发逻辑，不调 AI，不写 DB。
 * 由 scheduler 调用，输出 shouldTrigger 后交给 trigger-detector。
 */

import { supabase } from '@/lib/supabase/server';
import type { EvolutionRule } from './types';

export interface EvalResult {
  shouldTrigger: boolean;
  blockReason?: 'cooldown' | 'insufficient_runs' | 'duplicate_proposal' | 'disabled';
  blockDetail?: string;
}

/**
 * 评估单条规则是否应触发。
 * 纯逻辑 + DB 查询（读），不写任何数据。
 */
export async function evaluateRule(rule: EvolutionRule): Promise<EvalResult> {
  // 1. enabled 检查
  if (!rule.enabled) {
    return { shouldTrigger: false, blockReason: 'disabled' };
  }

  // 2. Cooldown 检查
  if (isInCooldown(rule)) {
    return {
      shouldTrigger: false,
      blockReason: 'cooldown',
      blockDetail: `冷却期剩余 ${remainingCooldownHours(rule)}h`,
    };
  }

  // 3. 最小执行数检查（metric 触发至少需要 3 次执行）
  if (rule.trigger_type === 'metric') {
    const runCount = await countRecentRuns(rule.workflow_id, rule.metric_range ?? '7d');
    if (runCount < 3) {
      return {
        shouldTrigger: false,
        blockReason: 'insufficient_runs',
        blockDetail: `近 ${rule.metric_range ?? '7d'} 仅 ${runCount} 次执行，需至少 3 次`,
      };
    }
  }

  // 4. 重复 proposal 防重（同工作流有 pending/analyzing 的事件则跳过）
  const hasPending = await hasPendingEvent(rule.workflow_id);
  if (hasPending) {
    return {
      shouldTrigger: false,
      blockReason: 'duplicate_proposal',
      blockDetail: '已有待处理的优化分析',
    };
  }

  return { shouldTrigger: true };
}

// ===== Cooldown =====

/** 规则是否在冷却期 */
export function isInCooldown(rule: EvolutionRule): boolean {
  if (!rule.last_triggered_at) return false;
  const elapsed = Date.now() - new Date(rule.last_triggered_at).getTime();
  return elapsed < rule.cooldown_hours * 3600 * 1000;
}

/** 冷却期剩余小时数（向上取整） */
export function remainingCooldownHours(rule: EvolutionRule): number {
  if (!rule.last_triggered_at) return 0;
  const elapsed = Date.now() - new Date(rule.last_triggered_at).getTime();
  const remaining = rule.cooldown_hours - elapsed / 3600_000;
  return Math.max(0, Math.ceil(remaining));
}

// ===== DB Queries =====

/** 统计近期执行次数 */
export async function countRecentRuns(workflowId: string, range: string): Promise<number> {
  const ms = rangeToMs(range);
  const cutoff = new Date(Date.now() - ms).toISOString();
  const { count } = await supabase
    .from('flow_runs')
    .select('id', { count: 'exact', head: true })
    .eq('workflow_id', workflowId)
    .gte('created_at', cutoff);
  return count ?? 0;
}

/** 同一工作流是否有 pending/analyzing 状态的事件 */
export async function hasPendingEvent(workflowId: string): Promise<boolean> {
  const { count } = await supabase
    .from('evolution_events')
    .select('id', { count: 'exact', head: true })
    .eq('workflow_id', workflowId)
    .in('analysis_status', ['pending', 'analyzing']);
  return (count ?? 0) > 0;
}

// ===== Helpers =====

function rangeToMs(range: string): number {
  switch (range) {
    case '24h': return 24 * 3600 * 1000;
    case '7d': return 7 * 24 * 3600 * 1000;
    case '30d': return 30 * 24 * 3600 * 1000;
    default: return 7 * 24 * 3600 * 1000;
  }
}
