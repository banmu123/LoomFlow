import { supabase } from '@/lib/supabase/server';

// ===== Milestone：真实行为首次达成的里程碑（非 XP）=====
// 类型/常量见 milestones-shared.ts（client 组件复用）
// 从现有数据推导（workflow_history / flow_runs / scheduled_runs / workflow_notes），
// 幂等奖励：UNIQUE(user_id, type)，每次 check 只插入缺失的。

import {
  MILESTONE_TYPES,
  MILESTONE_LABEL_KEY,
} from './milestones-shared';
import type { MilestoneType } from './milestones-shared';

export {
  MILESTONE_TYPES,
  MILESTONE_LABEL_KEY,
};
export type { MilestoneType } from './milestones-shared';

export interface Milestone {
  id: string;
  user_id: string;
  type: string;
  achieved_at: string;
  ref_workflow_id: string | null;
  ref_evidence: string | null;
  created_at: string;
}

/** 判定输入（从现有数据推导的真实行为） */
export interface MilestoneContext {
  hasNotes: boolean;
  hasSavedWorkflow: boolean;
  hasAiGeneratedWorkflow: boolean;
  hasComplexWorkflow: boolean;
  hasDebugRecovery: boolean;
  hasSchedule: boolean;
  /** 达成证据摘要（可读文本） */
  evidenceNote: string;
  /** 首个相关工作流 id（first_recipe/ai_creator/workflow_builder/debugger 关联用） */
  refWorkflowId: string | null;
}

/** 判定哪些里程碑达成（纯函数） */
export function evaluateMilestones(ctx: MilestoneContext): MilestoneType[] {
  const achieved: MilestoneType[] = [];
  if (ctx.hasNotes) achieved.push('first_brew');
  if (ctx.hasSavedWorkflow) achieved.push('first_recipe');
  if (ctx.hasAiGeneratedWorkflow) achieved.push('ai_creator');
  if (ctx.hasComplexWorkflow) achieved.push('workflow_builder');
  if (ctx.hasDebugRecovery) achieved.push('debugger');
  if (ctx.hasSchedule) achieved.push('automator');
  return achieved;
}

/** 从现有系统数据推导行为上下文（server 查询） */
export async function collectMilestoneContext(userId: string): Promise<MilestoneContext> {
  const ctx: MilestoneContext = {
    hasNotes: false,
    hasSavedWorkflow: false,
    hasAiGeneratedWorkflow: false,
    hasComplexWorkflow: false,
    hasDebugRecovery: false,
    hasSchedule: false,
    evidenceNote: '',
    refWorkflowId: null,
  };

  try {
    const [wfRes, runsRes, schedRes, notesRes] = await Promise.all([
      supabase
        .from('workflow_history')
        .select('id, saved, conversation_id, data')
        .eq('user_id', userId),
      supabase
        .from('flow_runs')
        .select('workflow_id, status')
        .eq('user_id', userId)
        .in('status', ['completed', 'failed']),
      supabase.from('scheduled_runs').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('workflow_notes').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    ]);

    const workflows = (wfRes.data ?? []) as Array<{
      id: string;
      saved: boolean;
      conversation_id: string | null;
      data: { nodes?: unknown[] } | null;
    }>;
    const saved = workflows.filter((w) => w.saved);
    ctx.hasSavedWorkflow = saved.length > 0;
    ctx.hasAiGeneratedWorkflow = saved.some((w) => !!w.conversation_id);
    ctx.hasComplexWorkflow = saved.some((w) => Array.isArray(w.data?.nodes) && w.data.nodes.length >= 3);
    ctx.refWorkflowId = saved[0]?.id ?? null;
    if (saved.length > 0) {
      ctx.evidenceNote = `${saved.length} 个工作流已保存`;
    }

    // Debugger：同一工作流既有失败又有成功执行（修复成功）
    const runs = (runsRes.data ?? []) as Array<{ workflow_id: string; status: string }>;
    const byWorkflow = new Map<string, { failed: boolean; completed: boolean }>();
    for (const r of runs) {
      const entry = byWorkflow.get(r.workflow_id) ?? { failed: false, completed: false };
      if (r.status === 'failed') entry.failed = true;
      if (r.status === 'completed') entry.completed = true;
      byWorkflow.set(r.workflow_id, entry);
    }
    ctx.hasDebugRecovery = [...byWorkflow.values()].some((e) => e.failed && e.completed);

    ctx.hasSchedule = (schedRes.count ?? 0) > 0;
    ctx.hasNotes = (notesRes.count ?? 0) > 0;
  } catch {
    // 任一数据源失败不阻断
  }
  return ctx;
}

/** 列出已达成里程碑 */
export async function listMilestones(userId: string): Promise<Milestone[]> {
  const { data } = await supabase
    .from('milestones')
    .select('*')
    .eq('user_id', userId)
    .order('achieved_at', { ascending: true });
  return (data ?? []) as Milestone[];
}

/** 幂等奖励：从真实行为推导并插入缺失的里程碑，返回本次新达成 */
export async function checkAndAwardMilestones(
  userId: string,
): Promise<{ awarded: MilestoneType[]; ctx: MilestoneContext }> {
  const ctx = await collectMilestoneContext(userId);
  const shouldAchieve = evaluateMilestones(ctx);
  if (shouldAchieve.length === 0) return { awarded: [], ctx };

  const { data: existing } = await supabase
    .from('milestones')
    .select('type')
    .eq('user_id', userId);
  const have = new Set((existing ?? []).map((m: { type: string }) => m.type));

  const awarded: MilestoneType[] = [];
  for (const type of shouldAchieve) {
    if (have.has(type)) continue;
    const { error } = await supabase.from('milestones').insert({
      user_id: userId,
      type,
      ref_workflow_id: ctx.refWorkflowId,
      ref_evidence: ctx.evidenceNote || null,
    });
    if (!error) {
      awarded.push(type);
      have.add(type);
    }
  }
  return { awarded, ctx };
}
