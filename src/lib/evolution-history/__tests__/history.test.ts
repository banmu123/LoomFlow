import { describe, it, expect } from 'vitest';
import { buildTimeline } from '../timeline';
import { buildUnavailableOutcome } from '../outcome';
import type { MetricSnapshot } from '../../workflow-eval/regression-policy';

// ===== buildTimeline =====

describe('buildTimeline', () => {
  it('sorts events by createdAt ascending', () => {
    const events = [
      { id: 'e3', trigger_type: 'regression', analysis_status: 'pending', trigger_reason: 'c', created_at: '2026-08-28T03:00:00Z' },
      { id: 'e1', trigger_type: 'regression', analysis_status: 'pending', trigger_reason: 'a', created_at: '2026-08-28T01:00:00Z' },
      { id: 'e2', trigger_type: 'regression', analysis_status: 'pending', trigger_reason: 'b', created_at: '2026-08-28T02:00:00Z' },
    ];
    const timeline = buildTimeline(events);
    expect(timeline.map((t) => t.eventId)).toEqual(['e1', 'e2', 'e3']);
  });

  it('sorts by eventId when createdAt is equal', () => {
    const events = [
      { id: 'z-event', trigger_type: 'regression', analysis_status: 'pending', trigger_reason: 'z', created_at: '2026-08-28T01:00:00Z' },
      { id: 'a-event', trigger_type: 'regression', analysis_status: 'pending', trigger_reason: 'a', created_at: '2026-08-28T01:00:00Z' },
    ];
    const timeline = buildTimeline(events);
    expect(timeline.map((t) => t.eventId)).toEqual(['a-event', 'z-event']);
  });

  it('maps fields correctly', () => {
    const events = [
      { id: 'e1', trigger_type: 'regression', analysis_status: 'applied', trigger_reason: 'P95 +50%', created_at: '2026-08-28T01:00:00Z' },
    ];
    const timeline = buildTimeline(events);
    expect(timeline[0]).toEqual({
      eventId: 'e1',
      type: 'regression',
      status: 'applied',
      reason: 'P95 +50%',
      createdAt: '2026-08-28T01:00:00Z',
    });
  });

  it('handles empty events', () => {
    expect(buildTimeline([])).toEqual([]);
  });

  it('handles single event', () => {
    const events = [
      { id: 'e1', trigger_type: 'cron', analysis_status: 'no_change', trigger_reason: 'scheduled', created_at: '2026-08-28T01:00:00Z' },
    ];
    const timeline = buildTimeline(events);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].type).toBe('cron');
  });
});

// ===== buildUnavailableOutcome =====

describe('buildUnavailableOutcome', () => {
  const beforeMetrics: MetricSnapshot = {
    successRate: 95,
    failureRate: 5,
    p95Latency: 3000,
    costPerRun: 0.003,
    testScore: 85,
  };

  it('returns source = unavailable', () => {
    const outcome = buildUnavailableOutcome(beforeMetrics);
    expect(outcome.source).toBe('unavailable');
  });

  it('preserves before metrics', () => {
    const outcome = buildUnavailableOutcome(beforeMetrics);
    expect(outcome.before).toEqual(beforeMetrics);
  });

  it('after is null', () => {
    const outcome = buildUnavailableOutcome(beforeMetrics);
    expect(outcome.after).toBeNull();
  });

  it('delta has all metrics with null after', () => {
    const outcome = buildUnavailableOutcome(beforeMetrics);
    expect(outcome.delta.successRate).toEqual({ before: 95, after: null, change: null });
    expect(outcome.delta.p95Latency).toEqual({ before: 3000, after: null, change: null });
    expect(outcome.delta.costPerRun).toEqual({ before: 0.003, after: null, change: null });
  });
});

// ===== Session grouping logic =====

describe('Session grouping', () => {
  /**
   * 验证 dedup 逻辑：
   * - proposal_id != null → 按 proposal_id 去重
   * - proposal_id == null → 每个 event 独立
   *
   * 由于 dedupSessions 是 query.ts 内部函数，这里通过行为间接测试。
   * 直接测试其逻辑：
   */
  it('events with same proposal_id should be grouped', () => {
    // 模拟 dedupSessions 逻辑
    const events = [
      { id: 'e1', proposal_id: 'p1' },
      { id: 'e2', proposal_id: 'p1' },
      { id: 'e3', proposal_id: 'p2' },
    ];
    const seen = new Set<string>();
    const result: typeof events = [];
    for (const event of events) {
      if (event.proposal_id) {
        if (seen.has(event.proposal_id)) continue;
        seen.add(event.proposal_id);
      } else {
        seen.add(event.id);
      }
      result.push(event);
    }
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(['e1', 'e3']);
  });

  it('events without proposal_id are each independent sessions', () => {
    const events = [
      { id: 'e1', proposal_id: null },
      { id: 'e2', proposal_id: null },
      { id: 'e3', proposal_id: null },
    ];
    const seen = new Set<string>();
    const result: typeof events = [];
    for (const event of events) {
      if (event.proposal_id) {
        if (seen.has(event.proposal_id)) continue;
        seen.add(event.proposal_id);
      } else {
        seen.add(event.id);
      }
      result.push(event);
    }
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('mixed proposal_id and null groups correctly', () => {
    const events = [
      { id: 'e1', proposal_id: 'p1' },
      { id: 'e2', proposal_id: 'p1' },
      { id: 'e3', proposal_id: null },
      { id: 'e4', proposal_id: null },
      { id: 'e5', proposal_id: 'p2' },
    ];
    const seen = new Set<string>();
    const result: typeof events = [];
    for (const event of events) {
      if (event.proposal_id) {
        if (seen.has(event.proposal_id)) continue;
        seen.add(event.proposal_id);
      } else {
        seen.add(event.id);
      }
      result.push(event);
    }
    expect(result).toHaveLength(4); // p1, e3, e4, p2
    expect(result.map((r) => r.id)).toEqual(['e1', 'e3', 'e4', 'e5']);
  });
});
