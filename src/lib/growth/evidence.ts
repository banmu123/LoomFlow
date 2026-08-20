import { supabase } from '@/lib/supabase/server';

// ===== Evidence Service =====
// 成长证据全部从现有系统真实行为推导（不依赖 AI 判断，不新增事件表）：
//   workflow_history / flow_runs / workflow_versions / scheduled_runs / workflow_notes
// 各模块不得直接修改 Capability——状态变更统一走 Growth Engine（engine.ts）。

export type EvidenceSource =
  | 'workflow_created' // 保存过工作流
  | 'workflow_generated' // AI 生成过工作流（带 conversation 关联）
  | 'workflow_edited' // 工作流产生过版本（v2+）
  | 'workflow_executed' // 执行过工作流（含失败）
  | 'workflow_executed_success' // 成功执行过
  | 'api_published' // 发布过 API
  | 'schedule_created' // 创建过定时任务
  | 'practice_completed' // 成功完成过练习（单节点/整体成功执行）
  | 'notes' // 写过 Brew Notes

export const EVIDENCE_SOURCES: EvidenceSource[] = [
  'workflow_created',
  'workflow_generated',
  'workflow_edited',
  'workflow_executed',
  'workflow_executed_success',
  'api_published',
  'schedule_created',
  'practice_completed',
  'notes',
];

export interface EvidenceRule {
  source: EvidenceSource;
  threshold: number;
}

export type EvidenceSummary = Record<EvidenceSource, number>;

export function emptyEvidence(): EvidenceSummary {
  return Object.fromEntries(EVIDENCE_SOURCES.map((s) => [s, 0])) as EvidenceSummary;
}

/** 从现有表聚合用户全部行为证据（一次并行查询） */
export async function collectEvidence(userId: string): Promise<EvidenceSummary> {
  const summary = emptyEvidence();
  try {
    const [wfRes, runsRes, versionsRes, schedRes, notesRes] = await Promise.all([
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
    // 练习完成 = 成功执行（画布试运行 + 外部调用）；失败也算实践但不算完成
    summary.practice_completed = summary.workflow_executed_success;

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

/** 证据规则 → 可读文本（i18n key 由前端映射） */
export function evidenceRuleLabel(rule: EvidenceRule): string {
  return `${rule.source}:${rule.threshold}`;
}
