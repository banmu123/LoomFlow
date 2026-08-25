/**
 * 读取执行历史与版本数据（Evaluation 数据源）
 * 24h / 7d / 30d 过滤在应用层完成（metrics.filterRunsByRange）。
 */

import { supabase } from '@/lib/supabase/server';
import type { RunTrace } from '../tinyflow/runtime/trace';
import type { RunRecordLike, EvalRange, NodeMetrics, WorkflowMetrics } from './metrics';
import { filterRunsByRange, aggregateWorkflowMetrics, aggregateNodeMetrics } from './metrics';

export interface HistoryRow {
  id: string;
  status: string;
  created_at: string;
  duration_ms?: number | null;
  retry_count?: number | null;
  token_usage?: RunRecordLike['token_usage'] | null;
  cost?: number | null;
  trace?: RunTrace | null;
  error?: string | null;
  workflow_id?: string | null;
}

const rowToRun = (r: Record<string, unknown>): RunRecordLike => ({
  id: String(r.id),
  status: String(r.status),
  created_at: String(r.created_at ?? ''),
  duration_ms: r.duration_ms != null ? Number(r.duration_ms) : null,
  retry_count: r.retry_count != null ? Number(r.retry_count) : null,
  token_usage: (r.token_usage ?? null) as RunRecordLike['token_usage'],
  cost: r.cost != null ? Number(r.cost) : null,
  trace: (r.trace ?? null) as RunTrace | null,
});

export async function listWorkflowRuns(
  workflowId: string,
  userId: string,
  limit = 500,
): Promise<RunRecordLike[]> {
  const { data, error } = await supabase
    .from('flow_runs')
    .select('id, workflow_id, status, created_at, duration_ms, retry_count, token_usage, cost, trace, error')
    .eq('workflow_id', workflowId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error || !data) return [];
  return ((data ?? []) as Array<Record<string, unknown>>).map(rowToRun);
}

export async function listSkillRunsForEval(
  skillId: string,
  userId: string,
  limit = 300,
): Promise<RunRecordLike[]> {
  const { data, error } = await supabase
    .from('skill_runs')
    .select('id, status, created_at, ran_at, duration_ms, token_usage, estimated_cost')
    .eq('skill_id', skillId)
    .order('ran_at', { ascending: true })
    .limit(limit);
  if (error || !data) return [];
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    status: ((r.status ?? '') as string),
    created_at: String(r.ran_at ?? r.created_at ?? ''),
    duration_ms: r.duration_ms != null ? Number(r.duration_ms) : null,
    retry_count: null,
    token_usage: null,
    cost: r.estimated_cost != null ? Number(r.estimated_cost) : null,
    trace: null,
  }));
}

export interface WorkflowEvalData {
  range: EvalRange;
  selectedRuns: RunRecordLike[];
  totalRuns: number;
  workflow: WorkflowMetrics;
  nodes: NodeMetrics[];
}

export async function getWorkflowEval(
  workflowId: string,
  userId: string,
  range: EvalRange,
): Promise<WorkflowEvalData> {
  const all = await listWorkflowRuns(workflowId, userId);
  const selected = filterRunsByRange(all, range);
  return {
    range,
    selectedRuns: selected,
    totalRuns: all.length,
    workflow: aggregateWorkflowMetrics(selected),
    nodes: aggregateNodeMetrics(selected).nodes,
  };
}

export async function getSkillEval(
  skillId: string,
  userId: string,
  range: EvalRange,
): Promise<WorkflowEvalData> {
  const all = await listSkillRunsForEval(skillId, userId);
  const selected = filterRunsByRange(all, range);
  return {
    range,
    selectedRuns: selected,
    totalRuns: all.length,
    workflow: aggregateWorkflowMetrics(selected),
    nodes: [],
  };
}

export async function getWorkflowVersionData(
  workflowId: string,
  version: number,
): Promise<{ data?: unknown; error?: string }> {
  const { data } = await supabase
    .from('workflow_versions')
    .select('data')
    .eq('workflow_id', workflowId)
    .eq('version', version)
    .maybeSingle();
  if (!data) return { error: `版本 v${version} 不存在` };
  return { data: data.data };
}