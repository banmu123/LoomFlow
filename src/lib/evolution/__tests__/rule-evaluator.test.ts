import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const from = vi.fn();
  return { from };
});

vi.mock('@/lib/supabase/server', () => ({
  supabase: { from: mocks.from },
}));

import { evaluateRule, isInCooldown, remainingCooldownHours, countRecentRuns, hasPendingEvent } from '../rule-evaluator';
import type { EvolutionRule } from '../types';

function makeChain(result: { data?: unknown; count?: number; error?: unknown }) {
  const obj: Record<string, unknown> = {};
  ['select', 'eq', 'gte', 'in', 'maybeSingle', 'single', 'order', 'limit'].forEach((k) => {
    obj[k] = vi.fn(() => obj);
  });
  obj.then = (resolve: (v: unknown) => void) => {
    resolve({ data: result.data ?? null, count: result.count ?? null, error: result.error ?? null });
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

beforeEach(() => {
  mocks.from.mockClear();
});

describe('isInCooldown', () => {
  it('returns false when never triggered', () => {
    const rule = makeRule({ last_triggered_at: null });
    expect(isInCooldown(rule)).toBe(false);
  });

  it('returns true when within cooldown period', () => {
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    const rule = makeRule({ last_triggered_at: oneHourAgo, cooldown_hours: 24 });
    expect(isInCooldown(rule)).toBe(true);
  });

  it('returns false when cooldown expired', () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 3600_000).toISOString();
    const rule = makeRule({ last_triggered_at: twoDaysAgo, cooldown_hours: 24 });
    expect(isInCooldown(rule)).toBe(false);
  });
});

describe('remainingCooldownHours', () => {
  it('returns 0 when never triggered', () => {
    const rule = makeRule({ last_triggered_at: null });
    expect(remainingCooldownHours(rule)).toBe(0);
  });

  it('returns positive hours when in cooldown', () => {
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    const rule = makeRule({ last_triggered_at: oneHourAgo, cooldown_hours: 24 });
    const remaining = remainingCooldownHours(rule);
    expect(remaining).toBeGreaterThan(22);
    expect(remaining).toBeLessThanOrEqual(23);
  });

  it('returns 0 when cooldown expired', () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 3600_000).toISOString();
    const rule = makeRule({ last_triggered_at: twoDaysAgo, cooldown_hours: 24 });
    expect(remainingCooldownHours(rule)).toBe(0);
  });
});

describe('evaluateRule', () => {
  it('blocks disabled rules', async () => {
    const rule = makeRule({ enabled: false });
    const result = await evaluateRule(rule);
    expect(result.shouldTrigger).toBe(false);
    expect(result.blockReason).toBe('disabled');
  });

  it('blocks rules in cooldown', async () => {
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    const rule = makeRule({ last_triggered_at: oneHourAgo, cooldown_hours: 24 });
    const result = await evaluateRule(rule);
    expect(result.shouldTrigger).toBe(false);
    expect(result.blockReason).toBe('cooldown');
  });

  it('blocks metric rules with insufficient runs', async () => {
    const rule = makeRule({ trigger_type: 'metric', metric_range: '7d' });
    // Mock countRecentRuns → only 1 run
    mocks.from.mockReturnValue(makeChain({ count: 1 }));
    const result = await evaluateRule(rule);
    expect(result.shouldTrigger).toBe(false);
    expect(result.blockReason).toBe('insufficient_runs');
  });

  it('blocks when pending event exists', async () => {
    const rule = makeRule();
    // First call: countRecentRuns → enough runs
    // Second call: hasPendingEvent → has pending
    let callCount = 0;
    mocks.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeChain({ count: 10 }); // runs
      return makeChain({ count: 1 }); // pending event
    });
    const result = await evaluateRule(rule);
    expect(result.shouldTrigger).toBe(false);
    expect(result.blockReason).toBe('duplicate_proposal');
  });

  it('allows rule when all checks pass', async () => {
    const rule = makeRule();
    let callCount = 0;
    mocks.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeChain({ count: 10 }); // runs
      return makeChain({ count: 0 }); // no pending
    });
    const result = await evaluateRule(rule);
    expect(result.shouldTrigger).toBe(true);
  });

  it('skips run count check for cron rules', async () => {
    const rule = makeRule({ trigger_type: 'cron', cron_expr: '0 3 * * *' });
    // Only one DB call expected (hasPendingEvent), not two
    mocks.from.mockReturnValue(makeChain({ count: 0 }));
    const result = await evaluateRule(rule);
    expect(result.shouldTrigger).toBe(true);
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it('skips run count check for event rules', async () => {
    const rule = makeRule({ trigger_type: 'event', event_type: 'consecutive_failures', event_threshold: 3 });
    mocks.from.mockReturnValue(makeChain({ count: 0 }));
    const result = await evaluateRule(rule);
    expect(result.shouldTrigger).toBe(true);
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
});
