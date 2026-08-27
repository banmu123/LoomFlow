/**
 * Evolution Engine — 共享类型定义
 *
 * 三张表的类型：evolution_rules / evolution_events / evolution_proposals
 * 以及触发检测、权限检查等共享类型。
 */

import type { WorkflowMetrics } from '../workflow-eval/metrics';

// ===== Database Models =====

export interface EvolutionRule {
  id: string;
  workflow_id: string;
  user_id: string;
  enabled: boolean;
  trigger_type: 'cron' | 'metric' | 'event';
  cron_expr: string | null;
  metric_key: string | null;
  metric_op: string | null;
  metric_threshold: number | null;
  metric_range: string | null;
  baseline_range: string | null;
  event_type: string | null;
  event_threshold: number | null;
  cooldown_hours: number;
  last_triggered_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type EvolutionAnalysisStatus =
  | 'pending'
  | 'analyzing'
  | 'proposal_created'
  | 'applied'
  | 'rejected'
  | 'failed'
  | 'no_change';

export interface EvolutionEvent {
  id: string;
  workflow_id: string;
  user_id: string;
  rule_id: string | null;
  trigger_type: string;
  trigger_reason: string;
  metric_snapshot: MetricSnapshot | null;
  analysis_status: EvolutionAnalysisStatus;
  proposal_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type EvolutionProposalStatus = 'pending' | 'applied' | 'rejected';

export interface EvolutionProposal {
  id: string;
  workflow_id: string;
  user_id: string;
  event_id: string;
  explanation: string;
  risk: string | null;
  operations: unknown[];
  proposal: unknown;
  schema_valid: boolean;
  issues: unknown[];
  test_summary: unknown | null;
  diff_markdown: string | null;
  status: EvolutionProposalStatus;
  applied_version: number | null;
  applied_at: string | null;
  rejected_at: string | null;
  idempotency_key: string | null;
  created_at: string;
}

// ===== Trigger Types =====

export type TriggerType = 'cron' | 'metric' | 'event' | 'manual';

export interface MetricSnapshot {
  current: WorkflowMetrics;
  baseline?: WorkflowMetrics;
  delta?: Record<string, { current: number; baseline: number; change: number }>;
}

export interface DetectionResult {
  triggered: boolean;
  reason: string;
  snapshot?: MetricSnapshot;
}

// ===== Permission Types =====

export type EvolutionAction =
  | 'rules:read'
  | 'rules:write'
  | 'events:read'
  | 'proposals:read'
  | 'proposals:write';

export interface AccessResult {
  allowed: boolean;
  userId: string;
  role: 'owner' | 'member' | 'admin';
  error?: string;
}
