import { supabase } from '@/lib/supabase/server';

// ===== Evidence Service =====
// 类型/常量/纯函数见 evidence-shared.ts（client 组件复用）
// 成长证据全部从现有系统真实行为推导（不依赖 AI 判断，不新增事件表）：
//   workflow_history / flow_runs / workflow_versions / scheduled_runs / workflow_notes
// 各模块不得直接修改 Capability——状态变更统一走 Growth Engine（engine.ts）。

import {
  EVIDENCE_SOURCES,
  emptyEvidence,
  evidenceRuleLabel,
} from './evidence-shared';
import type { EvidenceRule, EvidenceSummary, EvidenceSource } from './evidence-shared';

export {
  EVIDENCE_SOURCES,
  emptyEvidence,
  evidenceRuleLabel,
};
export type { EvidenceRule, EvidenceSummary, EvidenceSource } from './evidence-shared';

/** 从现有表聚合用户全部行为证据（一次并行查询） */
export async function collectEvidence(userId: string): Promise<EvidenceSummary> {
  const summary = emptyEvidence();
  try {
    const [wfRes, runsRes, versionsRes, schedRes, notesRes, practicesRes] = await Promise.all([
      supabase
        .from('workflow_history')
        .select('saved, conversation_id, published')
        .eq('user_id', userId),
      supabase.from('flow_runs').select('status').eq('user_id', userId),
      supabase
        .from('workflow_versions')
        .select('workflow_id')
        .eq('user_id', userId),
      supabase.from('scheduled_runs').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('workflow_notes').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      supabase
        .from('practices')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'completed'),
    ]);

    const workflows = (wfRes.data ?? []) as Array<{
      saved: boolean;
      conversation_id: string | null;
      published: boolean;
    }>;
    summary.workflow_created = workflows.filter((w) => w.saved).length;
    summary.workflow_generated = workflows.filter((w) => w.saved && w.conversation_id).length;
    summary.api_published = workflows.filter((w) => w.published).length;

    const runs = (runsRes.data ?? []) as Array<{ status: string }>;
    summary.workflow_executed = runs.length;
    summary.workflow_executed_success = runs.filter((r) => r.status === 'completed').length;

    // 练习完成 = practices 表中 status='completed' 的记录数
    summary.practice_completed = practicesRes.count ?? 0;

    const versions = (versionsRes.data ?? []) as Array<{ workflow_id: string }>;
    // 编辑 = 产生过至少一个版本的工作流数（v2+ 需要 >1 条版本，这里按版本条数近似）
    summary.workflow_edited = versions.length > 1 ? versions.length : Math.min(versions.length, 1);

    summary.schedule_created = schedRes.count ?? 0;
    summary.notes = notesRes.count ?? 0;
  } catch {
    // 任一数据源失败不阻断（返回已统计部分）
  }
  return summary;
}
