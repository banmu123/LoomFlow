/**
 * Evolution History — Record Aggregation
 *
 * 把 evolution_events / evolution_proposals / workflow_versions 聚合为
 * EvolutionHistoryRecord（Read Model）。
 *
 * Session grouping：
 *   - proposal_id != null → sessionId = proposal_id
 *   - proposal_id == null → sessionId = event.id（每个 event 独立 Session）
 *
 * Read Model：不复制完整 DB 记录，通过 ID + 必要 snapshot 聚合。
 * 不修改：regression.ts / baseline.ts / scheduler / regression-event。
 */

import { supabase } from '@/lib/supabase/server';
import { buildTimeline, type TimelineEntry } from './timeline';
import { calculateOutcome, buildUnavailableOutcome, type EvolutionOutcome } from './outcome';
import type { EvolutionAnalysisStatus } from '../evolution/types';
import type { MetricSnapshot, Severity } from '../workflow-eval/regression-policy';

// ===== Types =====

export interface EvolutionHistoryRecord {
  id: string;                    // Session ID = proposal.id 或 event.id
  workflowId: string;

  trigger: {
    type: string;
    reason: string;
    severity?: Severity;
    metricSnapshot?: unknown;
  };

  analysis: {
    summary: string;
    status: EvolutionAnalysisStatus;
  };

  proposal?: {
    id: string;
    explanation: string;
    risk: string | null;
    diffMarkdown: string | null;
    status: 'pending' | 'applied' | 'rejected';
  };

  decision: {
    status: 'pending' | 'applied' | 'rejected' | 'no_proposal';
    decidedAt?: string;
  };

  version?: {
    from: number | null;
    to: number;
  };

  outcome?: EvolutionOutcome;

  timeline: TimelineEntry[];

  createdAt: string;
  updatedAt: string;
}

// ===== Aggregation =====

/**
 * 从 evolution_events 聚合 EvolutionHistoryRecord。
 * 单个 event → 单个 Record（Read Model，不复制数据）。
 */
export async function aggregateHistoryRecord(
  event: {
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
  },
): Promise<EvolutionHistoryRecord> {
  const workflowId = event.workflow_id;

  // 1. 加载 proposal（如果有）
  const proposal = event.proposal_id
    ? await loadProposal(event.proposal_id)
    : null;

  // 2. 加载同一 Session 的所有事件（用于 timeline）
  const sessionEvents = proposal
    ? await loadEventsByProposalId(proposal.id)
    : [event]; // 无 proposal 时，单个 event 自身为 Session

  // 3. 构建 timeline
  const timeline = buildTimeline(sessionEvents);

  // 4. 确定 decision
  const decision = buildDecision(proposal, event.analysis_status);

  // 5. 确定 version（applied 时有值）
  const version = proposal?.applied_version
    ? await loadVersionInfo(workflowId, proposal.applied_version)
    : undefined;

  // 6. 计算 outcome（applied 且有 version 时）
  let outcome: EvolutionOutcome | undefined;
  if (proposal?.status === 'applied' && version) {
    const beforeMetrics = extractBeforeMetrics(event.metric_snapshot);
    if (beforeMetrics) {
      const versionRow = await loadVersionRow(workflowId, proposal.applied_version!);
      if (versionRow?.created_at) {
        outcome = await calculateOutcome(
          beforeMetrics,
          workflowId,
          versionRow.created_at,
          event.user_id,
        );
      } else {
        outcome = buildUnavailableOutcome(beforeMetrics);
      }
    }
  }

  // 7. 提取 trigger severity
  const severity = extractSeverity(event.metadata);

  return {
    id: proposal?.id ?? event.id,
    workflowId,
    trigger: {
      type: event.trigger_type,
      reason: event.trigger_reason,
      severity,
      metricSnapshot: event.metric_snapshot ?? undefined,
    },
    analysis: {
      summary: event.trigger_reason,
      status: event.analysis_status as EvolutionAnalysisStatus,
    },
    proposal: proposal
      ? {
          id: proposal.id,
          explanation: proposal.explanation,
          risk: proposal.risk,
          diffMarkdown: proposal.diff_markdown,
          status: proposal.status as 'pending' | 'applied' | 'rejected',
        }
      : undefined,
    decision,
    version,
    outcome,
    timeline,
    createdAt: event.created_at,
    updatedAt: event.updated_at,
  };
}

// ===== Internal Helpers =====

async function loadProposal(proposalId: string): Promise<{
  id: string;
  explanation: string;
  risk: string | null;
  diff_markdown: string | null;
  status: string;
  applied_version: number | null;
  applied_at: string | null;
  rejected_at: string | null;
} | null> {
  const { data } = await supabase
    .from('evolution_proposals')
    .select('id, explanation, risk, diff_markdown, status, applied_version, applied_at, rejected_at')
    .eq('id', proposalId)
    .maybeSingle();
  return data as typeof data | null;
}

async function loadEventsByProposalId(proposalId: string): Promise<Array<{
  id: string;
  trigger_type: string;
  analysis_status: string;
  trigger_reason: string;
  created_at: string;
}>> {
  const { data } = await supabase
    .from('evolution_events')
    .select('id, trigger_type, analysis_status, trigger_reason, created_at')
    .eq('proposal_id', proposalId)
    .order('created_at', { ascending: true });
  return (data ?? []) as Array<{
    id: string;
    trigger_type: string;
    analysis_status: string;
    trigger_reason: string;
    created_at: string;
  }>;
}

async function loadVersionInfo(
  workflowId: string,
  version: number,
): Promise<{ from: number | null; to: number } | undefined> {
  // 获取前一个版本号
  const { data: prevVersion } = await supabase
    .from('workflow_versions')
    .select('version')
    .eq('workflow_id', workflowId)
    .lt('version', version)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    from: prevVersion ? (prevVersion as { version: number }).version : null,
    to: version,
  };
}

async function loadVersionRow(
  workflowId: string,
  version: number,
): Promise<{ created_at: string } | null> {
  const { data } = await supabase
    .from('workflow_versions')
    .select('created_at')
    .eq('workflow_id', workflowId)
    .eq('version', version)
    .maybeSingle();
  return data as { created_at: string } | null;
}

function buildDecision(
  proposal: { status: string; applied_at: string | null; rejected_at: string | null } | null,
  analysisStatus: string,
): EvolutionHistoryRecord['decision'] {
  if (!proposal) {
    return { status: 'no_proposal' };
  }
  if (proposal.status === 'applied') {
    return { status: 'applied', decidedAt: proposal.applied_at ?? undefined };
  }
  if (proposal.status === 'rejected') {
    return { status: 'rejected', decidedAt: proposal.rejected_at ?? undefined };
  }
  return { status: 'pending' };
}

function extractBeforeMetrics(metricSnapshot: unknown): MetricSnapshot | null {
  if (!metricSnapshot || typeof metricSnapshot !== 'object') return null;
  const snap = metricSnapshot as Record<string, unknown>;
  // regression-event 存的结构：{ baseline, candidate, deltas }
  if (snap.baseline && typeof snap.baseline === 'object') {
    return snap.baseline as MetricSnapshot;
  }
  // rule-trigger 存的结构：MetricSnapshot（直接是指标值）
  if ('successRate' in snap) {
    return snap as unknown as MetricSnapshot;
  }
  return null;
}

function extractSeverity(metadata: Record<string, unknown>): Severity | undefined {
  if (metadata && typeof metadata === 'object' && 'overallSeverity' in metadata) {
    return metadata.overallSeverity as Severity;
  }
  return undefined;
}
