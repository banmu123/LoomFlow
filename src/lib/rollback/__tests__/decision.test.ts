import { describe, it, expect } from 'vitest';
import { DEFAULT_ROLLBACK_POLICY, decideRollback, type RollbackPolicy } from '../decision';

const now = new Date('2026-11-03T12:00:00Z').getTime();

function policy(overrides: Partial<RollbackPolicy> = {}): RollbackPolicy {
  return {
    workflowId: 'wf-1',
    ...DEFAULT_ROLLBACK_POLICY,
    enabled: true,
    dryRun: false,
    ...overrides,
  };
}

const healthy = {
  sampleCount: 50,
  successRate: 0.98,
  failureRate: 0.02,
  p95Latency: 900,
  costPerRun: 0.01,
  consecutiveFailures: 0,
};

const base = {
  policy: policy(),
  current: healthy,
  severity: 'info' as const,
  targetVersion: 1,
  autoRollbacksInCooldown: 0,
  lastRollbackAt: null,
  now,
};

describe('回滚决策', () => {
  it('策略未启用 → noop', () => {
    expect(decideRollback({ ...base, policy: policy({ enabled: false }) }).action).toBe('noop');
  });

  it('样本不足 → 只观察', () => {
    const decision = decideRollback({
      ...base,
      policy: policy({ minSamples: 50 }),
      current: { ...healthy, sampleCount: 10, consecutiveFailures: 10 },
      severity: 'critical',
    });
    expect(decision.action).toBe('observe');
    expect(decision.reasons.join()).toContain('样本不足');
  });

  it('指标正常 → 只观察（单次失败不触发）', () => {
    const decision = decideRollback({
      ...base,
      current: { ...healthy, consecutiveFailures: 1 },
    });
    expect(decision.action).toBe('observe');
  });

  it('连续失败达到阈值即可触发', () => {
    const decision = decideRollback({
      ...base,
      policy: policy({ mode: 'auto' }),
      current: { ...healthy, consecutiveFailures: 5 },
      severity: 'info',
    });
    expect(decision.action).toBe('auto_apply');
    expect(decision.confidence).toBe('medium');
  });

  it('manual 模式 → 需要人工审批', () => {
    const decision = decideRollback({
      ...base,
      policy: policy({ mode: 'manual' }),
      severity: 'critical',
    });
    expect(decision.action).toBe('manual_required');
  });

  it('dry run 优先于执行', () => {
    const decision = decideRollback({
      ...base,
      policy: policy({ mode: 'auto', dryRun: true }),
      severity: 'critical',
    });
    expect(decision.action).toBe('dry_run');
  });

  it('冷却期内不执行', () => {
    const decision = decideRollback({
      ...base,
      policy: policy({ mode: 'auto', cooldownMinutes: 60 }),
      severity: 'critical',
      lastRollbackAt: new Date(now - 10 * 60_000).toISOString(),
    });
    expect(decision.action).toBe('blocked');
    expect(decision.reasons.join()).toContain('冷却期');
  });

  it('自动回滚次数用尽 → 转人工', () => {
    const decision = decideRollback({
      ...base,
      policy: policy({ mode: 'auto', maxAutoRollbacks: 2 }),
      severity: 'critical',
      autoRollbacksInCooldown: 2,
    });
    expect(decision.action).toBe('manual_required');
  });

  it('没有历史版本 → 只观察', () => {
    const decision = decideRollback({
      ...base,
      targetVersion: null,
      severity: 'critical',
    });
    expect(decision.action).toBe('observe');
    expect(decision.targetVersion).toBeNull();
  });

  it('严重回归 + 连续失败 → 高置信度', () => {
    const decision = decideRollback({
      ...base,
      policy: policy({ mode: 'auto' }),
      severity: 'critical',
      current: { ...healthy, consecutiveFailures: 6 },
    });
    expect(decision.confidence).toBe('high');
    expect(decision.action).toBe('auto_apply');
  });
});
