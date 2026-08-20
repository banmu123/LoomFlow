// ===== Evidence 共享定义（纯类型/常量/纯函数，client 组件可安全引用）=====

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

/** 证据规则 → 可读文本（i18n key 由前端映射） */
export function evidenceRuleLabel(rule: EvidenceRule): string {
  return `${rule.source}:${rule.threshold}`;
}
