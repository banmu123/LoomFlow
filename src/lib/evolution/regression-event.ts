/**
 * Regression Event Adapter — Phase 4
 *
 * 适配层：RegressionReport → Evolution Event。
 * 把 P3 的纯函数检测结果接入现有 Evolution Engine。
 *
 * 职责：
 *   - 判断是否应创建 event
 *   - 生成 idempotency key
 *   - 构造 event payload
 *   - 调用底层 createEvolutionEvent
 *
 * 不含：Regression Detection 逻辑 / AI / Proposal / Quality Gate。
 * 不修改：regression.ts / baseline.ts / regression-policy.ts。
 */

import { createEvolutionEvent, type CreateEventInput } from './orchestrator';
import type { RegressionReport, OverallStatus, MetricStatus } from '../workflow-eval/regression';
import type { MetricName, MetricSnapshot, Severity } from '../workflow-eval/regression-policy';

// ===== Event Schema Version =====

const EVENT_SCHEMA_VERSION = 1;
const REGRESSION_REPORT_VERSION = 1;

// ===== Decision Functions =====

/**
 * 判断 RegressionReport 是否应创建 event。
 * 只有 regressed 和 tradeoff 才创建。
 */
export function shouldCreateRegressionEvent(report: RegressionReport): boolean {
  return report.status === 'regressed' || report.status === 'tradeoff';
}

/**
 * 判断 RegressionReport 是否应触发 optimization pipeline。
 * 只有 regressed 才触发；tradeoff 不自动触发。
 */
export function shouldTriggerOptimization(report: RegressionReport): boolean {
  return report.status === 'regressed';
}

// ===== Idempotency =====

/**
 * 生成 regression event 的 idempotency key。
 *
 * 格式：regression:{workflowId}:{baselineSig}:{candidateSig}:{regressedMetrics}
 *
 * 相同 workflowId + baseline + candidate + regressed metrics → 相同 key。
 * 不同 regressed metrics → 不同 key（允许分别记录）。
 */
export function buildRegressionIdempotencyKey(report: RegressionReport): string {
  const baselineSig = buildBaselineSignature(report);
  const candidateSig = buildCandidateSignature(report);
  const regressedMetrics = report.metrics
    .filter((m) => m.status === 'regressed')
    .map((m) => m.name)
    .sort()
    .join(',');

  return `regression:${report.workflowId}:${baselineSig}:${candidateSig}:${regressedMetrics}`;
}

function buildBaselineSignature(report: RegressionReport): string {
  const b = report.baseline;
  switch (b.type) {
    case 'version': return `v${b.version}`;
    case 'production': return 'prod';
    case 'rolling': return `rolling-${b.timeRange}`;
  }
}

function buildCandidateSignature(report: RegressionReport): string {
  const c = report.candidate;
  if (c.version !== undefined) return `v${c.version}`;
  if (c.timeRange) return `rolling-${c.timeRange}`;
  return 'current';
}

// ===== Event Payload =====

/** metric_snapshot 结构化证据 */
interface RegressionMetricDelta {
  name: MetricName;
  baseline: number;
  candidate: number;
  delta: number;
  deltaPercent: number | null;
  absoluteDelta: number;
  status: MetricStatus;
  severity: Severity;
  reason: string;
}

interface RegressionMetricSnapshot {
  baseline: MetricSnapshot;
  candidate: MetricSnapshot;
  deltas: RegressionMetricDelta[];
}

/** metadata 结构化字段 */
interface RegressionEventMetadata {
  eventSchemaVersion: number;
  regressionReportVersion: number;
  overallStatus: OverallStatus;
  overallSeverity: Severity;
  affectedNodes: string[];
  baselineType: string;
  baselineSampleCount: number;
  candidateSampleCount: number;
}

/**
 * 从 RegressionReport 构造 event payload。
 * metric_snapshot 存结构化证据，metadata 存 report 元信息。
 */
export function buildRegressionEventPayload(
  report: RegressionReport,
  userId: string,
  ruleId?: string,
): CreateEventInput {
  const metricSnapshot: RegressionMetricSnapshot = {
    baseline: report.baseline.metrics,
    candidate: report.candidate.metrics,
    deltas: report.metrics.map((m) => ({
      name: m.name,
      baseline: m.baseline,
      candidate: m.candidate,
      delta: m.delta,
      deltaPercent: m.deltaPercent,
      absoluteDelta: m.absoluteDelta,
      status: m.status,
      severity: m.severity,
      reason: m.reason,
    })),
  };

  const metadata: RegressionEventMetadata = {
    eventSchemaVersion: EVENT_SCHEMA_VERSION,
    regressionReportVersion: REGRESSION_REPORT_VERSION,
    overallStatus: report.status,
    overallSeverity: report.overallSeverity,
    affectedNodes: report.affectedNodes,
    baselineType: report.baseline.type,
    baselineSampleCount: report.baseline.sampleCount,
    candidateSampleCount: report.candidate.sampleCount,
  };

  return {
    workflowId: report.workflowId,
    userId,
    ruleId,
    triggerType: 'regression',
    triggerReason: report.summary,
    metricSnapshot,
    metadata: metadata as unknown as Record<string, unknown>,
    idempotencyKey: buildRegressionIdempotencyKey(report),
  };
}

// ===== Emit =====

export interface EmitResult {
  eventId: string;
  status: 'event_created' | 'skipped';
}

/**
 * 创建 Regression Event。
 *
 * 流程：
 * 1. shouldCreateRegressionEvent? → 不满足则 skipped
 * 2. 构造 payload（含 idempotency key）
 * 3. 调用 createEvolutionEvent（底层，DB UNIQUE 约束防重）
 * 4. DB 23505 冲突 → skipped（幂等）
 *
 * 不触发 optimization pipeline（留给 Scheduler / API）。
 */
export async function emitRegressionEvent(
  report: RegressionReport,
  userId: string,
  ruleId?: string,
): Promise<EmitResult> {
  if (!shouldCreateRegressionEvent(report)) {
    return { eventId: '', status: 'skipped' };
  }

  const payload = buildRegressionEventPayload(report, userId, ruleId);
  const eventId = await createEvolutionEvent(payload);

  // createEvolutionEvent 返回空字符串 = 幂等命中（23505 + idempotencyKey）
  if (!eventId) {
    return { eventId: '', status: 'skipped' };
  }

  return { eventId, status: 'event_created' };
}
