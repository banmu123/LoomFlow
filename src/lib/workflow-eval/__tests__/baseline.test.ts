import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const from = vi.fn();
  return { from };
});

vi.mock('@/lib/supabase/server', () => ({
  supabase: { from: mocks.from },
}));

import { getVersionBaseline, getProductionBaseline, getRollingBaseline } from '../baseline';

// ===== Mock Helpers =====

function makeChain(result: { data?: unknown[] | Record<string, unknown> | null; error?: unknown }) {
  const obj: Record<string, unknown> = {};
  ['select', 'eq', 'order', 'limit', 'maybeSingle', 'single'].forEach((k) => {
    obj[k] = vi.fn(() => obj);
  });
  obj.then = (resolve: (v: unknown) => void) => {
    resolve({ data: result.data ?? null, error: result.error ?? null });
  };
  return obj;
}

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: `run-${Math.random().toString(36).slice(2, 8)}`,
    workflow_id: 'w1',
    status: 'completed',
    created_at: new Date().toISOString(),
    duration_ms: 1000,
    retry_count: 0,
    token_usage: { totalTokens: 500 },
    cost: 0.001,
    trace: null,
    error: null,
    ...overrides,
  };
}

function makeRuns(count: number, overrides: Record<string, unknown> = {}) {
  return Array.from({ length: count }, (_, i) => makeRun({
    id: `run-${i}`,
    created_at: new Date(Date.now() - (count - i) * 60_000).toISOString(),
    ...overrides,
  }));
}

beforeEach(() => {
  mocks.from.mockClear();
});

// ===== Version Baseline =====

describe('getVersionBaseline', () => {
  it('returns unavailable when version does not exist', async () => {
    mocks.from.mockReturnValue(makeChain({ data: null }));
    const b = await getVersionBaseline('w1', 5);
    expect(b.status).toBe('unavailable');
    expect(b.type).toBe('version');
    expect(b.version).toBe(5);
    expect(b.sampleCount).toBe(0);
    expect(b.source).toContain('不存在');
  });

  it('returns ready when version exists and meets minimumSamples', async () => {
    mocks.from.mockReturnValue(makeChain({
      data: { data: { nodes: [{ id: 'n1', type: 'startNode', data: {} }], edges: [] }, created_at: new Date().toISOString() },
    }));
    const b = await getVersionBaseline('w1', 3, { minimumSamples: 1 });
    expect(b.status).toBe('ready');
    expect(b.type).toBe('version');
    expect(b.version).toBe(3);
    expect(b.sampleCount).toBe(1);
    expect(b.metrics.successRate).toBe(100);
    expect(b.metrics.failureRate).toBe(0);
    expect(b.metrics.p95Latency).toBe(0);
    expect(b.metrics.costPerRun).toBe(0);
    expect(b.metrics.testScore).toBe(100);
  });

  it('returns insufficient when version exists but minimumSamples > 1', async () => {
    mocks.from.mockReturnValue(makeChain({
      data: { data: { nodes: [], edges: [] }, created_at: new Date().toISOString() },
    }));
    const b = await getVersionBaseline('w1', 1, { minimumSamples: 10 });
    expect(b.status).toBe('insufficient');
    expect(b.sampleCount).toBe(1);
  });

  it('throws on database error', async () => {
    mocks.from.mockReturnValue(makeChain({ data: null, error: { message: 'connection refused' } }));
    await expect(getVersionBaseline('w1', 1)).rejects.toThrow('数据库查询失败');
  });
});

// ===== Production Baseline =====

describe('getProductionBaseline', () => {
  it('returns unavailable when no runs exist', async () => {
    mocks.from.mockReturnValue(makeChain({ data: [] }));
    const b = await getProductionBaseline('w1', 'u1');
    expect(b.status).toBe('unavailable');
    expect(b.type).toBe('production');
    expect(b.sampleCount).toBe(0);
    expect(b.source).toContain('无执行记录');
  });

  it('returns insufficient when runs < minimumSamples', async () => {
    const runs = makeRuns(5);
    mocks.from.mockReturnValue(makeChain({ data: runs }));
    const b = await getProductionBaseline('w1', 'u1', { minimumSamples: 20 });
    expect(b.status).toBe('insufficient');
    expect(b.sampleCount).toBe(5);
    expect(b.source).toContain('5');
  });

  it('returns ready with correct metrics when enough runs', async () => {
    const runs = makeRuns(25, { status: 'completed', duration_ms: 2000, cost: 0.002 });
    mocks.from.mockReturnValue(makeChain({ data: runs }));
    const b = await getProductionBaseline('w1', 'u1', { minimumSamples: 20 });
    expect(b.status).toBe('ready');
    expect(b.sampleCount).toBe(25);
    expect(b.type).toBe('production');
    expect(b.metrics.successRate).toBe(100);
    expect(b.metrics.failureRate).toBe(0);
    expect(b.metrics.p95Latency).toBeGreaterThan(0);
    expect(b.metrics.costPerRun).toBeGreaterThan(0);
  });

  it('returns unavailable on empty data array', async () => {
    mocks.from.mockReturnValue(makeChain({ data: null }));
    const b = await getProductionBaseline('w1', 'u1');
    expect(b.status).toBe('unavailable');
  });

  it('metrics reflect mixed run statuses', async () => {
    const runs = [
      ...makeRuns(15, { status: 'completed', duration_ms: 1000, cost: 0.001 }),
      ...makeRuns(10, { status: 'failed', duration_ms: 500, cost: 0.0005 }),
    ];
    mocks.from.mockReturnValue(makeChain({ data: runs }));
    const b = await getProductionBaseline('w1', 'u1', { minimumSamples: 20 });
    expect(b.status).toBe('ready');
    expect(b.metrics.successRate).toBe(60); // 15/25
    expect(b.metrics.failureRate).toBe(40); // 10/25
  });

  it('handles timeout runs correctly', async () => {
    const runs = [
      ...makeRuns(20, { status: 'completed' }),
      ...makeRuns(5, { status: 'timeout' }),
    ];
    mocks.from.mockReturnValue(makeChain({ data: runs }));
    const b = await getProductionBaseline('w1', 'u1', { minimumSamples: 20 });
    expect(b.metrics.successRate).toBe(80); // 20/25
    // timeout is tracked separately from failure in metrics.ts
    expect(b.metrics.failureRate).toBe(0);  // 0 failed, 5 timeout
  });

  it('cost is 0 when all runs have cost=0', async () => {
    const runs = makeRuns(25, { cost: 0 });
    mocks.from.mockReturnValue(makeChain({ data: runs }));
    const b = await getProductionBaseline('w1', 'u1');
    expect(b.status).toBe('ready');
    expect(b.metrics.costPerRun).toBe(0);
  });
});

// ===== Rolling Baseline =====

describe('getRollingBaseline', () => {
  it('returns unavailable when no runs in window', async () => {
    // All runs are old (30 days ago)
    const oldRuns = makeRuns(25, { created_at: new Date(Date.now() - 31 * 86400_000).toISOString() });
    mocks.from.mockReturnValue(makeChain({ data: oldRuns }));
    const b = await getRollingBaseline('w1', 'u1', '24h');
    expect(b.status).toBe('unavailable');
    expect(b.type).toBe('rolling');
    expect(b.timeRange).toBe('24h');
    expect(b.source).toContain('24h');
  });

  it('returns insufficient when runs in window < minimumSamples', async () => {
    const recentRuns = makeRuns(3, { created_at: new Date().toISOString() });
    mocks.from.mockReturnValue(makeChain({ data: recentRuns }));
    const b = await getRollingBaseline('w1', 'u1', '7d', { minimumSamples: 20 });
    expect(b.status).toBe('insufficient');
    expect(b.sampleCount).toBe(3);
  });

  it('returns ready when enough runs in window', async () => {
    const recentRuns = makeRuns(30, { created_at: new Date().toISOString() });
    mocks.from.mockReturnValue(makeChain({ data: recentRuns }));
    const b = await getRollingBaseline('w1', 'u1', '7d', { minimumSamples: 20 });
    expect(b.status).toBe('ready');
    expect(b.sampleCount).toBe(30);
    expect(b.timeRange).toBe('7d');
  });

  it('filters correctly for 24h', async () => {
    const now = Date.now();
    const runs = [
      ...makeRuns(15, { created_at: new Date(now - 12 * 3600_000).toISOString() }), // within 24h
      ...makeRuns(15, { created_at: new Date(now - 48 * 3600_000).toISOString() }), // outside 24h
    ];
    mocks.from.mockReturnValue(makeChain({ data: runs }));
    const b = await getRollingBaseline('w1', 'u1', '24h', { minimumSamples: 10 });
    expect(b.status).toBe('ready');
    expect(b.sampleCount).toBe(15);
  });

  it('filters correctly for 30d', async () => {
    const now = Date.now();
    const runs = [
      ...makeRuns(25, { created_at: new Date(now - 15 * 86400_000).toISOString() }), // within 30d
      ...makeRuns(5, { created_at: new Date(now - 35 * 86400_000).toISOString() }), // outside 30d
    ];
    mocks.from.mockReturnValue(makeChain({ data: runs }));
    const b = await getRollingBaseline('w1', 'u1', '30d', { minimumSamples: 20 });
    expect(b.status).toBe('ready');
    expect(b.sampleCount).toBe(25);
  });

  it('returns unavailable when all runs are outside window', async () => {
    const oldRuns = makeRuns(25, { created_at: new Date(Date.now() - 8 * 86400_000).toISOString() });
    mocks.from.mockReturnValue(makeChain({ data: oldRuns }));
    const b = await getRollingBaseline('w1', 'u1', '24h');
    expect(b.status).toBe('unavailable');
    expect(b.sampleCount).toBe(0);
  });
});

// ===== Metric Snapshot =====

describe('Baseline metrics', () => {
  it('production baseline produces correct MetricSnapshot fields', async () => {
    const runs = makeRuns(25, { status: 'completed', duration_ms: 3000, cost: 0.005 });
    mocks.from.mockReturnValue(makeChain({ data: runs }));
    const b = await getProductionBaseline('w1', 'u1');
    expect(b.metrics).toHaveProperty('successRate');
    expect(b.metrics).toHaveProperty('failureRate');
    expect(b.metrics).toHaveProperty('p95Latency');
    expect(b.metrics).toHaveProperty('costPerRun');
    expect(b.metrics).toHaveProperty('testScore');
    expect(typeof b.metrics.successRate).toBe('number');
    expect(typeof b.metrics.failureRate).toBe('number');
    expect(typeof b.metrics.p95Latency).toBe('number');
    expect(typeof b.metrics.costPerRun).toBe('number');
    expect(typeof b.metrics.testScore).toBe('number');
  });

  it('testScore defaults to 100 for production baseline', async () => {
    const runs = makeRuns(25);
    mocks.from.mockReturnValue(makeChain({ data: runs }));
    const b = await getProductionBaseline('w1', 'u1');
    expect(b.metrics.testScore).toBe(100);
  });

  it('testScore defaults to 100 for version baseline', async () => {
    mocks.from.mockReturnValue(makeChain({
      data: { data: { nodes: [], edges: [] }, created_at: new Date().toISOString() },
    }));
    const b = await getVersionBaseline('w1', 1, { minimumSamples: 1 });
    expect(b.metrics.testScore).toBe(100);
  });
});

// ===== Baseline Structure =====

describe('Baseline structure', () => {
  it('all baselines have required fields', async () => {
    const runs = makeRuns(25);
    mocks.from.mockReturnValue(makeChain({ data: runs }));
    const b = await getProductionBaseline('w1', 'u1');
    expect(b).toHaveProperty('workflowId');
    expect(b).toHaveProperty('type');
    expect(b).toHaveProperty('sampleCount');
    expect(b).toHaveProperty('status');
    expect(b).toHaveProperty('metrics');
    expect(b).toHaveProperty('source');
    expect(b).toHaveProperty('generatedAt');
    expect(b.workflowId).toBe('w1');
    expect(b.generatedAt).toBeTruthy();
  });

  it('version baseline includes version field', async () => {
    mocks.from.mockReturnValue(makeChain({
      data: { data: { nodes: [], edges: [] }, created_at: new Date().toISOString() },
    }));
    const b = await getVersionBaseline('w1', 5, { minimumSamples: 1 });
    expect(b.version).toBe(5);
    expect(b.timeRange).toBeUndefined();
  });

  it('rolling baseline includes timeRange field', async () => {
    const runs = makeRuns(25, { created_at: new Date().toISOString() });
    mocks.from.mockReturnValue(makeChain({ data: runs }));
    const b = await getRollingBaseline('w1', 'u1', '7d');
    expect(b.timeRange).toBe('7d');
    expect(b.version).toBeUndefined();
  });

  it('production baseline has no version or timeRange', async () => {
    const runs = makeRuns(25);
    mocks.from.mockReturnValue(makeChain({ data: runs }));
    const b = await getProductionBaseline('w1', 'u1');
    expect(b.version).toBeUndefined();
    expect(b.timeRange).toBeUndefined();
  });
});
