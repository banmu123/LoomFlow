/**
 * Evolution History — Query & Pagination
 *
 * 查询 + 分页 + 过滤。
 * 从 evolution_events 表查询，聚合为 EvolutionHistoryRecord。
 *
 * Read Model：不复制数据，通过 ID 引用。
 */

import { supabase } from '@/lib/supabase/server';
import { aggregateHistoryRecord, type EvolutionHistoryRecord } from './history';
import type { EvolutionAnalysisStatus } from '../evolution/types';
import type { Severity } from '../workflow-eval/regression-policy';

// ===== Query Types =====

export interface HistoryQuery {
  workflowId: string;
  timeRange?: '24h' | '7d' | '30d' | 'all';
  status?: EvolutionAnalysisStatus;
  severity?: Severity;
  limit?: number;
  offset?: number;
}

export interface HistoryQueryResult {
  records: EvolutionHistoryRecord[];
  total: number;
  limit: number;
  offset: number;
}

// ===== Query =====

/**
 * 查询 Evolution History。
 * 从 evolution_events 表读取，聚合为 EvolutionHistoryRecord。
 *
 * Session grouping：proposal_id != null 时按 proposal_id 去重。
 */
export async function queryEvolutionHistory(
  query: HistoryQuery,
): Promise<HistoryQueryResult> {
  const { workflowId, timeRange = 'all', status, severity, limit = 20, offset = 0 } = query;

  // 1. 构建查询
  let dbQuery = supabase
    .from('evolution_events')
    .select('*', { count: 'exact' })
    .eq('workflow_id', workflowId);

  // 时间过滤
  if (timeRange !== 'all') {
    const cutoff = getCutoff(timeRange);
    dbQuery = dbQuery.gte('created_at', cutoff);
  }

  // 状态过滤
  if (status) {
    dbQuery = dbQuery.eq('analysis_status', status);
  }

  // 按创建时间倒序
  dbQuery = dbQuery.order('created_at', { ascending: false });

  // 2. 获取总数（去重前）
  const { data: allEvents, count: totalRaw, error } = await dbQuery;
  if (error || !allEvents) {
    return { records: [], total: 0, limit, offset };
  }

  // 3. Session 去重：proposal_id != null 时按 proposal_id 聚合
  const sessions = dedupSessions(allEvents as EvolutionEventRow[]);

  // 4. Severity 过滤（需要聚合后才能检查）
  let filtered = sessions;
  if (severity) {
    filtered = sessions.filter((s) => {
      const sev = extractSeverity(s.metadata);
      return sev === severity;
    });
  }

  // 5. 分页
  const total = filtered.length;
  const paged = filtered.slice(offset, offset + limit);

  // 6. 聚合每条记录
  const records: EvolutionHistoryRecord[] = [];
  for (const event of paged) {
    try {
      const record = await aggregateHistoryRecord(event);
      records.push(record);
    } catch {
      // 聚合失败时跳过（不崩溃）
    }
  }

  return { records, total, limit, offset };
}

/**
 * 查询单条 Evolution History Record。
 */
export async function getEvolutionHistoryRecord(
  recordId: string,
): Promise<EvolutionHistoryRecord | null> {
  // recordId 可能是 proposal.id 或 event.id
  // 先尝试按 proposal_id 查找
  const { data: eventsByProposal } = await supabase
    .from('evolution_events')
    .select('*')
    .eq('proposal_id', recordId)
    .limit(1);

  if (eventsByProposal && eventsByProposal.length > 0) {
    return aggregateHistoryRecord(eventsByProposal[0] as EvolutionEventRow);
  }

  // 再尝试按 event.id 查找
  const { data: eventById } = await supabase
    .from('evolution_events')
    .select('*')
    .eq('id', recordId)
    .maybeSingle();

  if (eventById) {
    return aggregateHistoryRecord(eventById as EvolutionEventRow);
  }

  return null;
}

// ===== Internal =====

interface EvolutionEventRow {
  id: string;
  workflow_id: string;
  user_id: string;
  trigger_type: string;
  trigger_reason: string;
  metric_snapshot: unknown;
  analysis_status: string;
  proposal_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Session 去重：
 * - proposal_id != null → 按 proposal_id 分组，每组取第一条（代表事件）
 * - proposal_id == null → 每个 event 独立 Session
 */
function dedupSessions(events: EvolutionEventRow[]): EvolutionEventRow[] {
  const seen = new Set<string>();
  const result: EvolutionEventRow[] = [];

  for (const event of events) {
    if (event.proposal_id) {
      if (seen.has(event.proposal_id)) continue;
      seen.add(event.proposal_id);
    } else {
      // proposal_id == null：每个 event 独立，不合并
      seen.add(event.id);
    }
    result.push(event);
  }

  return result;
}

function getCutoff(range: string): string {
  const now = Date.now();
  let ms: number;
  switch (range) {
    case '24h': ms = 24 * 3600 * 1000; break;
    case '7d': ms = 7 * 24 * 3600 * 1000; break;
    case '30d': ms = 30 * 24 * 3600 * 1000; break;
    default: return new Date(0).toISOString();
  }
  return new Date(now - ms).toISOString();
}

function extractSeverity(metadata: Record<string, unknown>): Severity | undefined {
  if (metadata && typeof metadata === 'object' && 'overallSeverity' in metadata) {
    return metadata.overallSeverity as Severity;
  }
  return undefined;
}
