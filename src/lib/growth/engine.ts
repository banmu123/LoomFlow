import type { Capability, CapabilityStatus } from './types';
import type { EvidenceRule, EvidenceSummary } from './evidence';

// ===== Growth Engine =====
// 纯函数模块：Evidence → Capability Progress → Status（可被 client 组件安全引用）
// 唯一允许修改 Capability 状态的入口：applyCapabilityStatus（位于 growth-service.ts，server 侧）
// 规则：rule.source 的计数达标即推进状态（阈值→mastered，半阈值→developing，有记录→exploring）
// 已掌握不倒退（避免噪声误降级）。

const STATUS_RANK: Record<CapabilityStatus, number> = {
  locked: 0,
  exploring: 1,
  developing: 2,
  mastered: 3,
};

export const STATUS_LABEL_KEY: Record<CapabilityStatus, string> = {
  locked: 'growth.capStatusLocked',
  exploring: 'growth.capStatusExploring',
  developing: 'growth.capStatusDeveloping',
  mastered: 'growth.capStatusMastered',
};

/** 从 capability.metadata 读取证据规则 */
export function getEvidenceRule(cap: Capability): EvidenceRule | null {
  const rule = cap.metadata?.evidence_rule as EvidenceRule | undefined;
  if (!rule || typeof rule !== 'object') return null;
  if (typeof rule.source !== 'string' || typeof rule.threshold !== 'number') return null;
  if (rule.threshold < 1) return null;
  return { source: rule.source, threshold: Math.floor(rule.threshold) };
}

/** 按证据计算应达到的状态（纯函数） */
export function evaluateCapability(
  cap: Capability,
  evidence: EvidenceSummary,
): CapabilityStatus {
  const rule = getEvidenceRule(cap);
  if (!rule) return cap.status; // 无规则：不自动改

  const count = evidence[rule.source] ?? 0;
  let target: CapabilityStatus;
  if (count >= rule.threshold) {
    target = 'mastered';
  } else if (count >= Math.max(1, Math.ceil(rule.threshold / 2))) {
    target = 'developing';
  } else if (count > 0) {
    target = 'exploring';
  } else {
    target = 'locked';
  }

  // 已掌握不倒退
  const currentRank = STATUS_RANK[cap.status];
  const targetRank = STATUS_RANK[target];
  return targetRank >= currentRank ? target : cap.status;
}

/** 统一状态写入（Growth Engine 唯一写入口） */
/** 评估整个 Journey 的所有 Capability（返回变更列表） */
export function evaluateJourneyCapabilities(
  capabilities: Capability[],
  evidence: EvidenceSummary,
): Array<{ capabilityId: string; from: CapabilityStatus; to: CapabilityStatus }> {
  const changes: Array<{ capabilityId: string; from: CapabilityStatus; to: CapabilityStatus }> = [];
  for (const cap of capabilities) {
    const to = evaluateCapability(cap, evidence);
    if (to !== cap.status) {
      changes.push({ capabilityId: cap.id, from: cap.status, to });
    }
  }
  return changes;
}
