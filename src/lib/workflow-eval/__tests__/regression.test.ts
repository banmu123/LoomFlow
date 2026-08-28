import { describe, it, expect } from 'vitest';
import {
  evaluateMetric,
  determineOverallStatus,
  detectRegression,
  type MetricEvaluation,
  type ComparisonTarget,
} from '../regression';
import type { Baseline } from '../baseline';
import type { MetricSnapshot, RegressionRule, SeverityPolicy, SeverityThresholds } from '../regression-policy';
import {
  DEFAULT_REGRESSION_RULES,
  DEFAULT_SEVERITY_POLICY,
  METRIC_DEFINITIONS,
} from '../regression-policy';

// ===== Helpers =====

function makeSnapshot(overrides: Partial<MetricSnapshot> = {}): MetricSnapshot {
  return {
    successRate: 95,
    failureRate: 5,
    p95Latency: 3000,
    costPerRun: 0.003,
    testScore: 85,
    ...overrides,
  };
}

function makeBaseline(overrides: Partial<Baseline> = {}): Baseline {
  return {
    workflowId: 'w1',
    type: 'rolling',
    timeRange: '7d',
    sampleCount: 50,
    status: 'ready',
    metrics: makeSnapshot(),
    source: 'test',
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<ComparisonTarget> = {}): ComparisonTarget {
  return {
    sampleCount: 30,
    metrics: makeSnapshot(),
    ...overrides,
  };
}

const p95Rule: RegressionRule = { metric: 'p95Latency', relativeThreshold: 0.30, absoluteThreshold: 1000, minimumSamples: 20 };
const p95Sev: SeverityThresholds = DEFAULT_SEVERITY_POLICY.p95Latency;

// ===== evaluateMetric =====

describe('evaluateMetric', () => {
  it('returns stable when no change', () => {
    const r = evaluateMetric(3000, 3000, p95Rule, 'lower_is_better', p95Sev);
    expect(r.status).toBe('stable');
    expect(r.delta).toBe(0);
    expect(r.deltaPercent).toBe(0);
    expect(r.absoluteDelta).toBe(0);
    expect(r.severity).toBe('info');
  });

  it('returns regressed when both thresholds met (lower_is_better)', () => {
    // 3000 → 4500: +50%, +1500ms
    const r = evaluateMetric(3000, 4500, p95Rule, 'lower_is_better', p95Sev);
    expect(r.status).toBe('regressed');
    expect(r.deltaPercent).toBeCloseTo(50);
    expect(r.absoluteDelta).toBe(1500);
    expect(r.severity).not.toBe('info');
  });

  it('returns regressed when only relative threshold met (OR logic)', () => {
    // 100 → 150: +50%, +50ms
    // relative 50% >= 30% ✓, absolute 50ms < 1000ms ✗ → OR = regressed
    const r = evaluateMetric(100, 150, p95Rule, 'lower_is_better', p95Sev);
    expect(r.status).toBe('regressed');
  });

  it('returns stable when neither threshold met', () => {
    // 3000 → 3200: +6.7%, +200ms
    const r = evaluateMetric(3000, 3200, p95Rule, 'lower_is_better', p95Sev);
    expect(r.status).toBe('stable');
  });

  it('returns improved when both thresholds met (lower_is_better)', () => {
    // 5000 → 3000: -40%, -2000ms
    const r = evaluateMetric(5000, 3000, p95Rule, 'lower_is_better', p95Sev);
    expect(r.status).toBe('improved');
    expect(r.severity).toBe('info'); // improved → info severity
  });

  it('returns stable when improvement is minor (AND logic)', () => {
    // 3000 → 2900: -3.3%, -100ms — neither threshold met for improvement
    const r = evaluateMetric(3000, 2900, p95Rule, 'lower_is_better', p95Sev);
    expect(r.status).toBe('stable');
  });
});

// ===== Direction =====

describe('Direction handling', () => {
  it('successRate: candidate lower = regressed', () => {
    const rule: RegressionRule = { metric: 'successRate', relativeThreshold: 0.05, absoluteThreshold: 3, minimumSamples: 20 };
    const sev = DEFAULT_SEVERITY_POLICY.successRate;
    // 95 → 80: -15.8%, -15
    const r = evaluateMetric(95, 80, rule, 'higher_is_better', sev);
    expect(r.status).toBe('regressed');
  });

  it('successRate: candidate higher = improved', () => {
    const rule: RegressionRule = { metric: 'successRate', relativeThreshold: 0.05, absoluteThreshold: 3, minimumSamples: 20 };
    const sev = DEFAULT_SEVERITY_POLICY.successRate;
    // 80 → 95: +18.75%, +15
    const r = evaluateMetric(80, 95, rule, 'higher_is_better', sev);
    expect(r.status).toBe('improved');
  });

  it('failureRate: candidate higher = regressed', () => {
    const rule: RegressionRule = { metric: 'failureRate', relativeThreshold: 0.30, absoluteThreshold: 5, minimumSamples: 20 };
    const sev = DEFAULT_SEVERITY_POLICY.failureRate;
    // 5 → 20: +300%, +15
    const r = evaluateMetric(5, 20, rule, 'lower_is_better', sev);
    expect(r.status).toBe('regressed');
  });

  it('failureRate: candidate lower = improved', () => {
    const rule: RegressionRule = { metric: 'failureRate', relativeThreshold: 0.30, absoluteThreshold: 5, minimumSamples: 20 };
    const sev = DEFAULT_SEVERITY_POLICY.failureRate;
    // 20 → 5: -75%, -15
    const r = evaluateMetric(20, 5, rule, 'lower_is_better', sev);
    expect(r.status).toBe('improved');
  });

  it('costPerRun: candidate higher = regressed', () => {
    const rule: RegressionRule = { metric: 'costPerRun', relativeThreshold: 0.30, absoluteThreshold: 0.005, minimumSamples: 20 };
    const sev = DEFAULT_SEVERITY_POLICY.costPerRun;
    // 0.003 → 0.006: +100%, +0.003
    const r = evaluateMetric(0.003, 0.006, rule, 'lower_is_better', sev);
    expect(r.status).toBe('regressed');
  });

  it('testScore: candidate higher = improved', () => {
    const rule: RegressionRule = { metric: 'testScore', relativeThreshold: 0.10, absoluteThreshold: 10, minimumSamples: 5 };
    const sev = DEFAULT_SEVERITY_POLICY.testScore;
    // 70 → 90: +28.6%, +20
    const r = evaluateMetric(70, 90, rule, 'higher_is_better', sev);
    expect(r.status).toBe('improved');
  });

  it('testScore: candidate lower = regressed', () => {
    const rule: RegressionRule = { metric: 'testScore', relativeThreshold: 0.10, absoluteThreshold: 10, minimumSamples: 5 };
    const sev = DEFAULT_SEVERITY_POLICY.testScore;
    // 90 → 70: -22.2%, -20
    const r = evaluateMetric(90, 70, rule, 'higher_is_better', sev);
    expect(r.status).toBe('regressed');
  });
});

// ===== Threshold Edge Cases =====

describe('Threshold edge cases', () => {
  it('exactly at relative threshold = regressed', () => {
    // 3000 → 3900: +30%, +900ms
    // relative 30% >= 30% ✓ → regressed (OR logic)
    const r = evaluateMetric(3000, 3900, p95Rule, 'lower_is_better', p95Sev);
    expect(r.status).toBe('regressed');
  });

  it('just below relative threshold = stable (if absolute also not met)', () => {
    // 3000 → 3899: +29.97%, +899ms
    const r = evaluateMetric(3000, 3899, p95Rule, 'lower_is_better', p95Sev);
    expect(r.status).toBe('stable');
  });

  it('just above absolute threshold = regressed (if relative also met)', () => {
    // 100 → 131: +31%, +31ms — relative met, absolute 31 < 1000
    // OR logic: relative met → regressed
    const r = evaluateMetric(100, 131, p95Rule, 'lower_is_better', p95Sev);
    expect(r.status).toBe('regressed');
  });
});

// ===== Absolute Threshold =====

describe('Absolute threshold', () => {
  it('exactly at absolute threshold', () => {
    const rule: RegressionRule = { metric: 'p95Latency', absoluteThreshold: 1000, minimumSamples: 20 };
    const sev = DEFAULT_SEVERITY_POLICY.p95Latency;
    // 5000 → 6000: +1000ms
    const r = evaluateMetric(5000, 6000, rule, 'lower_is_better', sev);
    expect(r.status).toBe('regressed');
  });

  it('above absolute threshold', () => {
    const rule: RegressionRule = { metric: 'p95Latency', absoluteThreshold: 1000, minimumSamples: 20 };
    const sev = DEFAULT_SEVERITY_POLICY.p95Latency;
    const r = evaluateMetric(5000, 7000, rule, 'lower_is_better', sev);
    expect(r.status).toBe('regressed');
  });

  it('below absolute threshold', () => {
    const rule: RegressionRule = { metric: 'p95Latency', absoluteThreshold: 1000, minimumSamples: 20 };
    const sev = DEFAULT_SEVERITY_POLICY.p95Latency;
    const r = evaluateMetric(5000, 5500, rule, 'lower_is_better', sev);
    expect(r.status).toBe('stable');
  });
});

// ===== Edge Cases: Zero Values =====

describe('Zero value handling', () => {
  it('baseline=0, candidate=0 → stable', () => {
    const rule: RegressionRule = { metric: 'failureRate', relativeThreshold: 0.30, absoluteThreshold: 5, minimumSamples: 20 };
    const sev = DEFAULT_SEVERITY_POLICY.failureRate;
    const r = evaluateMetric(0, 0, rule, 'lower_is_better', sev);
    expect(r.status).toBe('stable');
    expect(r.deltaPercent).toBe(0);
  });

  it('failureRate: 0 → 5 = regressed, deltaPercent=null', () => {
    const rule: RegressionRule = { metric: 'failureRate', relativeThreshold: 0.30, absoluteThreshold: 5, minimumSamples: 20 };
    const sev = DEFAULT_SEVERITY_POLICY.failureRate;
    const r = evaluateMetric(0, 5, rule, 'lower_is_better', sev);
    expect(r.status).toBe('regressed');
    expect(r.deltaPercent).toBeNull();
    expect(r.absoluteDelta).toBe(5);
    expect(r.reason).toContain('相对变化不适用');
  });

  it('successRate: 0 → 100 = improved (higher_is_better), deltaPercent=null', () => {
    const rule: RegressionRule = { metric: 'successRate', relativeThreshold: 0.05, absoluteThreshold: 3, minimumSamples: 20 };
    const sev = DEFAULT_SEVERITY_POLICY.successRate;
    const r = evaluateMetric(0, 100, rule, 'higher_is_better', sev);
    expect(r.status).toBe('improved');
    expect(r.deltaPercent).toBeNull();
  });

  it('cost: 0 → 0.001 = regressed (lower_is_better, OR logic: relative=Infinity), deltaPercent=null', () => {
    const rule: RegressionRule = { metric: 'costPerRun', relativeThreshold: 0.30, absoluteThreshold: 0.005, minimumSamples: 20 };
    const sev = DEFAULT_SEVERITY_POLICY.costPerRun;
    // baseline=0 → relativeDelta=Infinity → OR logic: relative met → regressed
    const r = evaluateMetric(0, 0.001, rule, 'lower_is_better', sev);
    expect(r.status).toBe('regressed');
    expect(r.deltaPercent).toBeNull();
  });

  it('p95Latency: 100 → 150, severity not incorrectly lowered by small absolute', () => {
    // +50% relative, +50ms absolute
    // relative threshold 30% met → regressed
    // severity uses |effectiveAbsDelta| = 50 → classifySeverity(50, {low:0.10,...})
    // 50 >= 0.10 → at least low
    const r = evaluateMetric(100, 150, p95Rule, 'lower_is_better', p95Sev);
    expect(r.status).toBe('regressed');
    expect(r.severity).not.toBe('info');
  });
});

// ===== determineOverallStatus =====

describe('determineOverallStatus', () => {
  function makeEval(status: MetricEvaluation['status']): MetricEvaluation {
    return { name: 'p95Latency', baseline: 0, candidate: 0, delta: 0, deltaPercent: 0, absoluteDelta: 0, status, severity: 'info', reason: '' };
  }

  it('all stable → stable', () => {
    expect(determineOverallStatus([makeEval('stable'), makeEval('stable')])).toBe('stable');
  });

  it('all inconclusive → inconclusive', () => {
    expect(determineOverallStatus([makeEval('inconclusive'), makeEval('inconclusive')])).toBe('inconclusive');
  });

  it('regressed + stable → regressed', () => {
    expect(determineOverallStatus([makeEval('regressed'), makeEval('stable')])).toBe('regressed');
  });

  it('improved + stable → improved', () => {
    expect(determineOverallStatus([makeEval('improved'), makeEval('stable')])).toBe('improved');
  });

  it('regressed + improved → tradeoff', () => {
    expect(determineOverallStatus([makeEval('regressed'), makeEval('improved')])).toBe('tradeoff');
  });

  it('regressed + improved + stable → tradeoff', () => {
    expect(determineOverallStatus([makeEval('regressed'), makeEval('improved'), makeEval('stable')])).toBe('tradeoff');
  });

  it('regressed + inconclusive → regressed', () => {
    expect(determineOverallStatus([makeEval('regressed'), makeEval('inconclusive')])).toBe('regressed');
  });

  it('improved + inconclusive → improved', () => {
    expect(determineOverallStatus([makeEval('improved'), makeEval('inconclusive')])).toBe('improved');
  });
});

// ===== detectRegression: Full Integration =====

describe('detectRegression', () => {
  it('identical metrics → stable', () => {
    const metrics = makeSnapshot();
    const r = detectRegression(makeBaseline({ metrics }), makeCandidate({ metrics, sampleCount: 50 }));
    expect(r.status).toBe('stable');
    expect(r.metrics.every((m) => m.status === 'stable')).toBe(true);
  });

  it('p95Latency regressed, cost improved → tradeoff', () => {
    // cost: 0.010 → 0.002 = -80% relative, -0.008 absolute (>= 0.005 threshold)
    const baselineMetrics = makeSnapshot({ p95Latency: 3000, costPerRun: 0.010 });
    const candidateMetrics = makeSnapshot({ p95Latency: 4500, costPerRun: 0.002 });
    const r = detectRegression(
      makeBaseline({ metrics: baselineMetrics, sampleCount: 50 }),
      makeCandidate({ metrics: candidateMetrics, sampleCount: 50 }),
    );
    expect(r.status).toBe('tradeoff');
    const p95 = r.metrics.find((m) => m.name === 'p95Latency');
    const cost = r.metrics.find((m) => m.name === 'costPerRun');
    expect(p95?.status).toBe('regressed');
    expect(cost?.status).toBe('improved');
  });

  it('cost regressed, success stable → regressed', () => {
    const baselineMetrics = makeSnapshot({ costPerRun: 0.003 });
    const candidateMetrics = makeSnapshot({ costPerRun: 0.008 });
    const r = detectRegression(
      makeBaseline({ metrics: baselineMetrics, sampleCount: 50 }),
      makeCandidate({ metrics: candidateMetrics, sampleCount: 50 }),
    );
    const cost = r.metrics.find((m) => m.name === 'costPerRun');
    expect(cost?.status).toBe('regressed');
    expect(r.status).toBe('regressed');
  });

  it('latency inconclusive + cost regressed → regressed', () => {
    // Use custom rules: p95 needs 100 samples, cost needs 10
    const customRules: RegressionRule[] = [
      { metric: 'p95Latency', relativeThreshold: 0.30, absoluteThreshold: 1000, minimumSamples: 100 },
      { metric: 'costPerRun', relativeThreshold: 0.30, absoluteThreshold: 0.005, minimumSamples: 10 },
    ];
    const r = detectRegression(
      makeBaseline({ metrics: makeSnapshot({ p95Latency: 3000, costPerRun: 0.003 }), sampleCount: 50 }),
      makeCandidate({ metrics: makeSnapshot({ p95Latency: 4500, costPerRun: 0.008 }), sampleCount: 50 }),
      customRules,
    );
    const p95 = r.metrics.find((m) => m.name === 'p95Latency');
    const cost = r.metrics.find((m) => m.name === 'costPerRun');
    expect(p95?.status).toBe('inconclusive'); // 50 < 100
    expect(cost?.status).toBe('regressed');    // 50 >= 10
    expect(r.status).toBe('regressed');        // regressed dominates inconclusive
  });

  it('all inconclusive → inconclusive', () => {
    const r = detectRegression(
      makeBaseline({ sampleCount: 0, status: 'unavailable' }),
      makeCandidate({ sampleCount: 0 }),
    );
    expect(r.status).toBe('inconclusive');
  });

  it('failureRate: 0→5 → regressed, deltaPercent=null', () => {
    const baselineMetrics = makeSnapshot({ failureRate: 0 });
    const candidateMetrics = makeSnapshot({ failureRate: 5 });
    const r = detectRegression(
      makeBaseline({ metrics: baselineMetrics }),
      makeCandidate({ metrics: candidateMetrics, sampleCount: 30 }),
    );
    const fr = r.metrics.find((m) => m.name === 'failureRate');
    expect(fr?.status).toBe('regressed');
    expect(fr?.deltaPercent).toBeNull();
    expect(fr?.absoluteDelta).toBe(5);
  });

  it('includes baseline and candidate metrics in report', () => {
    const bMetrics = makeSnapshot({ p95Latency: 3000 });
    const cMetrics = makeSnapshot({ p95Latency: 3100 });
    const r = detectRegression(
      makeBaseline({ metrics: bMetrics }),
      makeCandidate({ metrics: cMetrics, sampleCount: 30 }),
    );
    expect(r.baseline.metrics).toEqual(bMetrics);
    expect(r.candidate.metrics).toEqual(cMetrics);
  });

  it('baseline includes type, version, timeRange', () => {
    const r = detectRegression(
      makeBaseline({ type: 'version', version: 5 }),
      makeCandidate({ sampleCount: 30 }),
    );
    expect(r.baseline.type).toBe('version');
    expect(r.baseline.version).toBe(5);
  });

  it('candidate includes version and timeRange', () => {
    const r = detectRegression(
      makeBaseline(),
      makeCandidate({ version: 6, timeRange: '7d', sampleCount: 30 }),
    );
    expect(r.candidate.version).toBe(6);
    expect(r.candidate.timeRange).toBe('7d');
  });

  it('summary reflects status', () => {
    // regressed
    const r1 = detectRegression(
      makeBaseline({ metrics: makeSnapshot({ p95Latency: 3000 }) }),
      makeCandidate({ metrics: makeSnapshot({ p95Latency: 4500 }), sampleCount: 30 }),
    );
    expect(r1.summary).toContain('退化');

    // stable
    const r2 = detectRegression(
      makeBaseline({ metrics: makeSnapshot() }),
      makeCandidate({ metrics: makeSnapshot(), sampleCount: 50 }),
    );
    expect(r2.summary).toContain('稳定');
  });

  it('overallSeverity reflects worst regressed metric', () => {
    const r = detectRegression(
      makeBaseline({ metrics: makeSnapshot({ p95Latency: 3000, failureRate: 5 }) }),
      makeCandidate({ metrics: makeSnapshot({ p95Latency: 6000, failureRate: 50 }), sampleCount: 30 }),
    );
    expect(r.overallSeverity).not.toBe('info');
  });

  it('uses custom rules when provided', () => {
    const customRules: RegressionRule[] = [
      { metric: 'p95Latency', relativeThreshold: 0.10, absoluteThreshold: 100, minimumSamples: 5 },
    ];
    const r = detectRegression(
      makeBaseline({ metrics: makeSnapshot({ p95Latency: 1000 }) }),
      makeCandidate({ metrics: makeSnapshot({ p95Latency: 1200 }), sampleCount: 30 }),
      customRules,
    );
    const p95 = r.metrics.find((m) => m.name === 'p95Latency');
    expect(p95?.status).toBe('regressed'); // +20% >= 10%
  });
});
