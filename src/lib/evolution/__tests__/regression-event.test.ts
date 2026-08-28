import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const from = vi.fn();
  return { from };
});

vi.mock('@/lib/supabase/server', () => ({
  supabase: { from: mocks.from },
}));

import {
  shouldCreateRegressionEvent,
  shouldTriggerOptimization,
  buildRegressionIdempotencyKey,
  buildRegressionEventPayload,
  emitRegressionEvent,
} from '../regression-event';
import type { RegressionReport, OverallStatus } from '../../workflow-eval/regression';
import type { MetricSnapshot } from '../../workflow-eval/regression-policy';

// ===== Helpers =====

function makeSnapshot(overrides: Partial<MetricSnapshot> = {}): MetricSnapshot {
  return {
    successRate: 95, failureRate: 5, p95Latency: 3000, costPerRun: 0.003, testScore: 85,
    ...overrides,
  };
}

function makeReport(overrides: Partial<RegressionReport> = {}): RegressionReport {
  return {
    workflowId: 'w1',
    status: 'regressed',
    baseline: {
      type: 'rolling', timeRange: '7d', sampleCount: 50,
      metrics: makeSnapshot(),
    },
    candidate: { sampleCount: 30, metrics: makeSnapshot({ p95Latency: 4500 }) },
    metrics: [
      {
        name: 'p95Latency', baseline: 3000, candidate: 4500,
        delta: 0.5, deltaPercent: 50, absoluteDelta: 1500,
        status: 'regressed', severity: 'high',
        reason: '退化 +50.0%（3000 → 4500）',
      },
      {
        name: 'successRate', baseline: 95, candidate: 95,
        delta: 0, deltaPercent: 0, absoluteDelta: 0,
        status: 'stable', severity: 'info', reason: '稳定',
      },
      {
        name: 'failureRate', baseline: 5, candidate: 5,
        delta: 0, deltaPercent: 0, absoluteDelta: 0,
        status: 'stable', severity: 'info', reason: '稳定',
      },
      {
        name: 'costPerRun', baseline: 0.003, candidate: 0.003,
        delta: 0, deltaPercent: 0, absoluteDelta: 0,
        status: 'stable', severity: 'info', reason: '稳定',
      },
      {
        name: 'testScore', baseline: 85, candidate: 85,
        delta: 0, deltaPercent: 0, absoluteDelta: 0,
        status: 'stable', severity: 'info', reason: '稳定',
      },
    ],
    overallSeverity: 'high',
    affectedNodes: [],
    summary: '检测到退化：P95 Latency。',
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeChain(result: { data?: { id: string } | null; error?: { code?: string; message?: string } | null }) {
  const obj: Record<string, unknown> = {};
  ['select', 'single', 'insert'].forEach((k) => {
    obj[k] = vi.fn(() => obj);
  });
  obj.then = (resolve: (v: unknown) => void) => {
    resolve({ data: result.data ?? null, error: result.error ?? null });
  };
  return obj;
}

beforeEach(() => {
  mocks.from.mockClear();
});

// ===== shouldCreateRegressionEvent =====

describe('shouldCreateRegressionEvent', () => {
  it('returns true for regressed', () => {
    expect(shouldCreateRegressionEvent(makeReport({ status: 'regressed' }))).toBe(true);
  });

  it('returns true for tradeoff', () => {
    expect(shouldCreateRegressionEvent(makeReport({ status: 'tradeoff' }))).toBe(true);
  });

  it('returns false for stable', () => {
    expect(shouldCreateRegressionEvent(makeReport({ status: 'stable' }))).toBe(false);
  });

  it('returns false for improved', () => {
    expect(shouldCreateRegressionEvent(makeReport({ status: 'improved' }))).toBe(false);
  });

  it('returns false for inconclusive', () => {
    expect(shouldCreateRegressionEvent(makeReport({ status: 'inconclusive' }))).toBe(false);
  });
});

// ===== shouldTriggerOptimization =====

describe('shouldTriggerOptimization', () => {
  it('returns true for regressed', () => {
    expect(shouldTriggerOptimization(makeReport({ status: 'regressed' }))).toBe(true);
  });

  it('returns false for tradeoff', () => {
    expect(shouldTriggerOptimization(makeReport({ status: 'tradeoff' }))).toBe(false);
  });

  it('returns false for stable', () => {
    expect(shouldTriggerOptimization(makeReport({ status: 'stable' }))).toBe(false);
  });

  it('returns false for improved', () => {
    expect(shouldTriggerOptimization(makeReport({ status: 'improved' }))).toBe(false);
  });

  it('returns false for inconclusive', () => {
    expect(shouldTriggerOptimization(makeReport({ status: 'inconclusive' }))).toBe(false);
  });
});

// ===== buildRegressionIdempotencyKey =====

describe('buildRegressionIdempotencyKey', () => {
  it('produces stable key for same input', () => {
    const r = makeReport();
    const k1 = buildRegressionIdempotencyKey(r);
    const k2 = buildRegressionIdempotencyKey(r);
    expect(k1).toBe(k2);
  });

  it('starts with regression: prefix', () => {
    const key = buildRegressionIdempotencyKey(makeReport());
    expect(key).toMatch(/^regression:/);
  });

  it('includes workflowId', () => {
    const key = buildRegressionIdempotencyKey(makeReport({ workflowId: 'wf-abc' }));
    expect(key).toContain('wf-abc');
  });

  it('different key for different regressed metrics', () => {
    const r1 = makeReport({
      metrics: [
        { name: 'p95Latency', baseline: 3000, candidate: 4500, delta: 0.5, deltaPercent: 50, absoluteDelta: 1500, status: 'regressed', severity: 'high', reason: '' },
        { name: 'costPerRun', baseline: 0.003, candidate: 0.003, delta: 0, deltaPercent: 0, absoluteDelta: 0, status: 'stable', severity: 'info', reason: '' },
      ],
    });
    const r2 = makeReport({
      metrics: [
        { name: 'p95Latency', baseline: 3000, candidate: 3100, delta: 0.03, deltaPercent: 3, absoluteDelta: 100, status: 'stable', severity: 'info', reason: '' },
        { name: 'costPerRun', baseline: 0.003, candidate: 0.008, delta: 1.67, deltaPercent: 167, absoluteDelta: 0.005, status: 'regressed', severity: 'medium', reason: '' },
      ],
    });
    expect(buildRegressionIdempotencyKey(r1)).not.toBe(buildRegressionIdempotencyKey(r2));
  });

  it('different key for different baseline type', () => {
    const r1 = makeReport({ baseline: { type: 'rolling', timeRange: '7d', sampleCount: 50, metrics: makeSnapshot() } });
    const r2 = makeReport({ baseline: { type: 'production', sampleCount: 100, metrics: makeSnapshot() } });
    expect(buildRegressionIdempotencyKey(r1)).not.toBe(buildRegressionIdempotencyKey(r2));
  });

  it('includes baseline version for version baseline', () => {
    const r = makeReport({ baseline: { type: 'version', version: 5, sampleCount: 1, metrics: makeSnapshot() } });
    expect(buildRegressionIdempotencyKey(r)).toContain('v5');
  });
});

// ===== buildRegressionEventPayload =====

describe('buildRegressionEventPayload', () => {
  it('contains structured metric_snapshot with baseline, candidate, deltas', () => {
    const report = makeReport();
    const payload = buildRegressionEventPayload(report, 'u1', 'r1');
    const snapshot = payload.metricSnapshot as Record<string, unknown>;
    expect(snapshot).toHaveProperty('baseline');
    expect(snapshot).toHaveProperty('candidate');
    expect(snapshot).toHaveProperty('deltas');
    const deltas = snapshot.deltas as Array<Record<string, unknown>>;
    expect(deltas.length).toBe(report.metrics.length);
    expect(deltas[0]).toHaveProperty('name');
    expect(deltas[0]).toHaveProperty('baseline');
    expect(deltas[0]).toHaveProperty('candidate');
    expect(deltas[0]).toHaveProperty('delta');
    expect(deltas[0]).toHaveProperty('status');
    expect(deltas[0]).toHaveProperty('severity');
  });

  it('contains metadata with schema versions', () => {
    const payload = buildRegressionEventPayload(makeReport(), 'u1');
    const meta = payload.metadata as Record<string, unknown>;
    expect(meta.eventSchemaVersion).toBe(1);
    expect(meta.regressionReportVersion).toBe(1);
    expect(meta.overallStatus).toBe('regressed');
    expect(meta.overallSeverity).toBe('high');
  });

  it('sets triggerType to regression', () => {
    const payload = buildRegressionEventPayload(makeReport(), 'u1');
    expect(payload.triggerType).toBe('regression');
  });

  it('sets triggerReason to report summary', () => {
    const report = makeReport({ summary: 'P95 Latency 退化 50%' });
    const payload = buildRegressionEventPayload(report, 'u1');
    expect(payload.triggerReason).toBe('P95 Latency 退化 50%');
  });

  it('includes idempotencyKey', () => {
    const payload = buildRegressionEventPayload(makeReport(), 'u1');
    expect(payload.idempotencyKey).toBeTruthy();
    expect(payload.idempotencyKey).toMatch(/^regression:/);
  });

  it('includes ruleId when provided', () => {
    const payload = buildRegressionEventPayload(makeReport(), 'u1', 'rule-123');
    expect(payload.ruleId).toBe('rule-123');
  });

  it('ruleId is optional', () => {
    const payload = buildRegressionEventPayload(makeReport(), 'u1');
    expect(payload.ruleId).toBeUndefined();
  });
});

// ===== emitRegressionEvent =====

describe('emitRegressionEvent', () => {
  it('creates event for regressed report', async () => {
    mocks.from.mockReturnValue(makeChain({ data: { id: 'ev-1' } }));
    const result = await emitRegressionEvent(makeReport({ status: 'regressed' }), 'u1');
    expect(result.status).toBe('event_created');
    expect(result.eventId).toBe('ev-1');
  });

  it('skips event for stable report', async () => {
    const result = await emitRegressionEvent(makeReport({ status: 'stable' }), 'u1');
    expect(result.status).toBe('skipped');
    expect(result.eventId).toBe('');
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('skips event for improved report', async () => {
    const result = await emitRegressionEvent(makeReport({ status: 'improved' }), 'u1');
    expect(result.status).toBe('skipped');
  });

  it('skips event for inconclusive report', async () => {
    const result = await emitRegressionEvent(makeReport({ status: 'inconclusive' }), 'u1');
    expect(result.status).toBe('skipped');
  });

  it('creates event for tradeoff report', async () => {
    mocks.from.mockReturnValue(makeChain({ data: { id: 'ev-2' } }));
    const result = await emitRegressionEvent(makeReport({ status: 'tradeoff' }), 'u1');
    expect(result.status).toBe('event_created');
  });

  it('handles idempotency (DB 23505 with idempotencyKey → skipped)', async () => {
    mocks.from.mockReturnValue(makeChain({ data: null, error: { code: '23505', message: 'duplicate key' } }));
    const result = await emitRegressionEvent(makeReport({ status: 'regressed' }), 'u1');
    expect(result.status).toBe('skipped');
    expect(result.eventId).toBe('');
  });

  it('throws on non-idempotency DB error', async () => {
    mocks.from.mockReturnValue(makeChain({ data: null, error: { code: 'XX000', message: 'connection refused' } }));
    await expect(emitRegressionEvent(makeReport({ status: 'regressed' }), 'u1')).rejects.toThrow('创建事件失败');
  });

  it('passes userId and ruleId to payload', async () => {
    mocks.from.mockReturnValue(makeChain({ data: { id: 'ev-3' } }));
    const result = await emitRegressionEvent(makeReport(), 'user-abc', 'rule-xyz');
    expect(result.status).toBe('event_created');
    expect(result.eventId).toBe('ev-3');
    expect(mocks.from).toHaveBeenCalled();
  });
});
