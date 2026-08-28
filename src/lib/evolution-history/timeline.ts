/**
 * Evolution History — Timeline Builder
 *
 * 构建单个 Evolution Session 内的事件时间线。
 * 按 createdAt 排序，createdAt 相同时按 event.id 排序（稳定排序）。
 *
 * Read Model：不写入任何数据。
 */

// ===== Types =====

export interface TimelineEntry {
  eventId: string;
  type: string;
  status: string;
  reason: string;
  createdAt: string;
}

// ===== Builder =====

/**
 * 从 evolution_events 列表构建 Timeline。
 * 输入应为同一 Session 的事件（共享 proposal_id 或同一 event.id）。
 *
 * 排序规则：
 * 1. createdAt 升序
 * 2. createdAt 相同时按 event.id 字典序（稳定）
 */
export function buildTimeline(
  events: Array<{
    id: string;
    trigger_type: string;
    analysis_status: string;
    trigger_reason: string;
    created_at: string;
  }>,
): TimelineEntry[] {
  return events
    .map((e) => ({
      eventId: e.id,
      type: e.trigger_type,
      status: e.analysis_status,
      reason: e.trigger_reason,
      createdAt: e.created_at,
    }))
    .sort((a, b) => {
      const timeCmp = a.createdAt.localeCompare(b.createdAt);
      if (timeCmp !== 0) return timeCmp;
      return a.eventId.localeCompare(b.eventId);
    });
}
