import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const from = vi.fn();
  return { from };
});

vi.mock('@/lib/supabase/server', () => ({
  supabase: { from: mocks.from },
}));

import { detectCron, detectMetric, detectEvent } from '../trigger-detector';
import type { EvolutionRule } from '../types';

function makeChain(result: { data?: unknown[] }) {
  const obj: Record<string, unknown> = {};
  ['select', 'eq', 'gte', 'order', 'limit'].forEach((k) => {
    obj[k] = vi.fn(() => obj);
  });
  obj.then = (resolve: (v: unknown) => void) => {
    resolve({ data: result.data ?? [], error: null });
  };
  return obj;
}

function makeRule(overrides: Partial<EvolutionRule> = {}): EvolutionRule {
  return {
    id: 'r1',
    workflow_id: 'w1',
    user_id: 'u1',
    enabled: true,
    trigger_type: 'metric',
    cron_expr: null,
    metric_key: 'latency_p95',
    metric_op: 'pct_increase',
    metric_threshold: 0.3,
    metric_range: '7d',
    baseline_range: '30d',
    event_type: null,
    event_threshold: null,
    cooldown_hours: 24,
    last_triggered_at: null,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeRun(status: string, durationMs: number) {
  return {
    id: `run-${Math.random()}`,
    status,
    created_at: new Date().toISOString(),
    duration_ms: durationMs,
    retry_count: 0,
    token_usage: { totalTokens: 100 },
    cost: 0.001,
    trace: null,
  };
}

beforeEach(() => {
  mocks.from.mockClear();
});

describe('detectCron', () => {
  it('always triggers', () => {
    const rule = makeRule({ trigger_type: 'cron', cron_expr: '0 3 * * *' });
    const result = detectCron(rule);
    expect(result.triggered).toBe(true);
    expect(result.reason).toContain('0 3 * * *');
  });
});

describe('detectMetric', () => {
  it('returns false when config incomplete', async () => {
    const rule = makeRule({ metric_key: null });
    const result = await detectMetric(rule);
    expect(result.triggered).toBe(false);
    expect(result.reason).toContain('不完整');
  });

  it('returns false with insufficient runs', async () => {
    const rule = makeRule();
    mocks.from.mockReturnValue(makeChain({ data: [makeRun('completed', 1000)] }));
    const result = await detectMetric(rule);
    expect(result.triggered).toBe(false);
    expect(result.reason).toContain('不足');
  });

  it('triggers when latency increases beyond threshold', async () => {
    const rule = makeRule({ trigger_type: 'metric', metric_key: 'latency_p95', metric_op: 'pct_increase', metric_threshold: 0.3 });
    // Current: high latency, Baseline: low latency
    const highLatencyRuns = Array.from({ length: 5 }, () => makeRun('completed', 5000));
    const lowLatencyRuns = Array.from({ length: 10 }, () => makeRun('completed', 2000));

    let callCount = 0;
    mocks.from.mockImplementation(() => {
      callCount++;
      if (callCount <= 2) return makeChain({ data: highLatencyRuns }); // current range (2 calls: count + data)
      return makeChain({ data: lowLatencyRuns }); // baseline range
    });

    // Override to return enough data for both calls
    mocks.from.mockImplementation(() => {
      callCount++;
      // Return data for both current and baseline queries
      return makeChain({ data: callCount <= 1 ? highLatencyRuns : lowLatencyRuns });
    });

    const result = await detectMetric(rule);
    // The test depends on aggregateWorkflowMetrics computing p95 correctly
    // With 5 runs at 5000ms vs 10 runs at 2000ms, pct_increase = (5000-2000)/2000 = 1.5 > 0.3
    expect(result.triggered).toBe(true);
    expect(result.reason).toContain('增长');
    expect(result.snapshot).toBeDefined();
    expect(result.snapshot?.current).toBeDefined();
    expect(result.snapshot?.baseline).toBeDefined();
  });

  it('does not trigger when metric is within threshold', async () => {
    const rule = makeRule({ metric_key: 'latency_p95', metric_op: 'pct_increase', metric_threshold: 0.5 });
    const similarRuns = Array.from({ length: 5 }, () => makeRun('completed', 2100));
    const baselineRuns = Array.from({ length: 10 }, () => makeRun('completed', 2000));

    let callCount = 0;
    mocks.from.mockImplementation(() => {
      callCount++;
      return makeChain({ data: callCount <= 1 ? similarRuns : baselineRuns });
    });

    const result = await detectMetric(rule);
    // pct_increase = (2100-2000)/2000 = 0.05 < 0.5
    expect(result.triggered).toBe(false);
  });
});

describe('detectEvent', () => {
  it('returns false when config incomplete', async () => {
    const rule = makeRule({ trigger_type: 'event', event_type: null });
    const result = await detectEvent(rule);
    expect(result.triggered).toBe(false);
    expect(result.reason).toContain('不完整');
  });

  it('returns false with insufficient runs', async () => {
    const rule = makeRule({ trigger_type: 'event', event_type: 'consecutive_failures', event_threshold: 3 });
    mocks.from.mockReturnValue(makeChain({ data: [{ status: 'failed', created_at: new Date().toISOString() }] }));
    const result = await detectEvent(rule);
    expect(result.triggered).toBe(false);
    expect(result.reason).toContain('不足');
  });

  it('triggers on consecutive failures', async () => {
    const rule = makeRule({ trigger_type: 'event', event_type: 'consecutive_failures', event_threshold: 3 });
    const failedRuns = [
      { status: 'failed', created_at: new Date().toISOString() },
      { status: 'failed', created_at: new Date().toISOString() },
      { status: 'failed', created_at: new Date().toISOString() },
    ];
    mocks.from.mockReturnValue(makeChain({ data: failedRuns }));
    const result = await detectEvent(rule);
    expect(result.triggered).toBe(true);
    expect(result.reason).toContain('全部失败');
  });

  it('does not trigger when runs are mixed', async () => {
    const rule = makeRule({ trigger_type: 'event', event_type: 'consecutive_failures', event_threshold: 3 });
    const mixedRuns = [
      { status: 'failed', created_at: new Date().toISOString() },
      { status: 'completed', created_at: new Date().toISOString() },
      { status: 'failed', created_at: new Date().toISOString() },
    ];
    mocks.from.mockReturnValue(makeChain({ data: mixedRuns }));
    const result = await detectEvent(rule);
    expect(result.triggered).toBe(false);
  });

  it('triggers on consecutive timeouts', async () => {
    const rule = makeRule({ trigger_type: 'event', event_type: 'consecutive_timeouts', event_threshold: 3 });
    const timeoutRuns = [
      { status: 'timeout', created_at: new Date().toISOString() },
      { status: 'timeout', created_at: new Date().toISOString() },
      { status: 'timeout', created_at: new Date().toISOString() },
    ];
    mocks.from.mockReturnValue(makeChain({ data: timeoutRuns }));
    const result = await detectEvent(rule);
    expect(result.triggered).toBe(true);
    expect(result.reason).toContain('全部超时');
  });
});
