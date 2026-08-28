import { describe, it, expect } from 'vitest';
import {
  classifySeverity,
  maxSeverity,
  maxSeverityFrom,
  relativeDelta,
  absoluteDelta,
  isRegressed,
  isImproved,
  extractMetricValue,
  toMetricSnapshot,
  DEFAULT_SEVERITY_POLICY,
  DEFAULT_REGRESSION_RULES,
  METRIC_DEFINITIONS,
  ALL_METRIC_NAMES,
  type SeverityThresholds,
  type RegressionRule,
  type MetricSnapshot,
} from '../regression-policy';

// ===== classifySeverity =====

describe('classifySeverity', () => {
  const thresholds: SeverityThresholds = { low: 0.1, medium: 0.3, high: 0.5, critical: 1.0 };

  it('returns info when below low', () => {
    expect(classifySeverity(0.05, thresholds)).toBe('info');
  });

  it('returns low when at low threshold', () => {
    expect(classifySeverity(0.1, thresholds)).toBe('low');
  });

  it('returns medium when at medium threshold', () => {
    expect(classifySeverity(0.3, thresholds)).toBe('medium');
  });

  it('returns high when at high threshold', () => {
    expect(classifySeverity(0.5, thresholds)).toBe('high');
  });

  it('returns critical when at critical threshold', () => {
    expect(classifySeverity(1.0, thresholds)).toBe('critical');
  });

  it('returns critical when above critical', () => {
    expect(classifySeverity(2.0, thresholds)).toBe('critical');
  });

  it('returns info when delta is 0', () => {
    expect(classifySeverity(0, thresholds)).toBe('info');
  });
});

// ===== maxSeverity =====

describe('maxSeverity', () => {
  it('returns higher of two severities', () => {
    expect(maxSeverity('low', 'high')).toBe('high');
    expect(maxSeverity('critical', 'medium')).toBe('critical');
    expect(maxSeverity('info', 'info')).toBe('info');
  });

  it('handles all severity pairs', () => {
    expect(maxSeverity('info', 'critical')).toBe('critical');
    expect(maxSeverity('critical', 'info')).toBe('critical');
    expect(maxSeverity('medium', 'low')).toBe('medium');
  });
});

// ===== maxSeverityFrom =====

describe('maxSeverityFrom', () => {
  it('returns highest from list', () => {
    expect(maxSeverityFrom(['info', 'low', 'medium'])).toBe('medium');
    expect(maxSeverityFrom(['critical', 'high', 'low'])).toBe('critical');
    expect(maxSeverityFrom(['info'])).toBe('info');
  });

  it('returns info for empty list', () => {
    expect(maxSeverityFrom([])).toBe('info');
  });

  it('returns critical when all are critical', () => {
    expect(maxSeverityFrom(['critical', 'critical'])).toBe('critical');
  });
});

// ===== relativeDelta =====

describe('relativeDelta', () => {
  it('calculates positive percentage change', () => {
    expect(relativeDelta(100, 130)).toBeCloseTo(0.3);
  });

  it('calculates negative percentage change', () => {
    expect(relativeDelta(100, 70)).toBeCloseTo(-0.3);
  });

  it('returns 0 when no change', () => {
    expect(relativeDelta(100, 100)).toBe(0);
  });

  it('returns 0 when baseline is 0', () => {
    expect(relativeDelta(0, 100)).toBe(0);
    expect(relativeDelta(0, 0)).toBe(0);
  });
});

// ===== absoluteDelta =====

describe('absoluteDelta', () => {
  it('calculates positive delta', () => {
    expect(absoluteDelta(100, 130)).toBe(30);
  });

  it('calculates negative delta', () => {
    expect(absoluteDelta(100, 70)).toBe(-30);
  });

  it('returns 0 when no change', () => {
    expect(absoluteDelta(100, 100)).toBe(0);
  });
});

// ===== isRegressed =====

describe('isRegressed', () => {
  const rule: RegressionRule = { metric: 'p95Latency', relativeThreshold: 0.3, absoluteThreshold: 1000, minimumSamples: 20 };

  it('returns true when BOTH thresholds met (lower_is_better)', () => {
    // 3200 → 4400: delta=+37.5%, absDelta=+1200
    expect(isRegressed(0.375, 1200, rule, 'lower_is_better')).toBe(true);
  });

  it('returns false when only relative threshold met', () => {
    // 100 → 130: delta=+30%, absDelta=+30
    expect(isRegressed(0.30, 30, rule, 'lower_is_better')).toBe(false);
  });

  it('returns false when only absolute threshold met', () => {
    // 10000 → 11000: delta=+10%, absDelta=+1000
    expect(isRegressed(0.10, 1000, rule, 'lower_is_better')).toBe(false);
  });

  it('returns false when neither threshold met', () => {
    expect(isRegressed(0.05, 50, rule, 'lower_is_better')).toBe(false);
  });

  it('returns false when metric improved (lower_is_better)', () => {
    // 4000 → 3000: delta=-25%, absDelta=-1000
    expect(isRegressed(-0.25, -1000, rule, 'lower_is_better')).toBe(false);
  });

  it('returns false when delta is exactly 0', () => {
    expect(isRegressed(0, 0, rule, 'lower_is_better')).toBe(false);
  });

  it('handles higher_is_better direction (successRate)', () => {
    const successRule: RegressionRule = { metric: 'successRate', relativeThreshold: 0.05, absoluteThreshold: 3, minimumSamples: 20 };
    // 95 → 85: delta=-10.5%, absDelta=-10 → regressed
    expect(isRegressed(-0.105, -10, successRule, 'higher_is_better')).toBe(true);
    // 95 → 93: delta=-2.1%, absDelta=-2 → not regressed
    expect(isRegressed(-0.021, -2, successRule, 'higher_is_better')).toBe(false);
  });

  it('returns false for higher_is_better when metric increased', () => {
    const r: RegressionRule = { metric: 'testScore', relativeThreshold: 0.10, absoluteThreshold: 10, minimumSamples: 5 };
    // 70 → 85: delta=+21.4%, absDelta=+15 → improved, not regressed
    expect(isRegressed(0.214, 15, r, 'higher_is_better')).toBe(false);
  });

  it('works with only relative threshold', () => {
    const r: RegressionRule = { metric: 'p95Latency', relativeThreshold: 0.3, minimumSamples: 20 };
    expect(isRegressed(0.35, 50, r, 'lower_is_better')).toBe(true);
  });

  it('works with only absolute threshold', () => {
    const r: RegressionRule = { metric: 'p95Latency', absoluteThreshold: 1000, minimumSamples: 20 };
    expect(isRegressed(0.05, 1200, r, 'lower_is_better')).toBe(true);
  });

  it('returns false when no thresholds configured', () => {
    const r: RegressionRule = { metric: 'p95Latency', minimumSamples: 20 };
    expect(isRegressed(0.99, 99999, r, 'lower_is_better')).toBe(false);
  });
});

// ===== isImproved =====

describe('isImproved', () => {
  const rule: RegressionRule = { metric: 'p95Latency', relativeThreshold: 0.3, absoluteThreshold: 1000, minimumSamples: 20 };

  it('returns true when BOTH thresholds met for improvement (lower_is_better)', () => {
    // 4000 → 2800: delta=-30%, absDelta=-1200
    expect(isImproved(-0.30, -1200, rule, 'lower_is_better')).toBe(true);
  });

  it('returns false when metric regressed', () => {
    expect(isImproved(0.30, 1200, rule, 'lower_is_better')).toBe(false);
  });

  it('returns false when change is minor', () => {
    expect(isImproved(-0.05, -50, rule, 'lower_is_better')).toBe(false);
  });

  it('returns false when delta is 0', () => {
    expect(isImproved(0, 0, rule, 'lower_is_better')).toBe(false);
  });

  it('handles higher_is_better direction', () => {
    const r: RegressionRule = { metric: 'testScore', relativeThreshold: 0.10, absoluteThreshold: 10, minimumSamples: 5 };
    // 70 → 85: delta=+21.4%, absDelta=+15
    expect(isImproved(0.214, 15, r, 'higher_is_better')).toBe(true);
    // 70 → 73: delta=+4.3%, absDelta=+3
    expect(isImproved(0.043, 3, r, 'higher_is_better')).toBe(false);
  });

  it('works with only relative threshold', () => {
    const r: RegressionRule = { metric: 'p95Latency', relativeThreshold: 0.3, minimumSamples: 20 };
    expect(isImproved(-0.35, -50, r, 'lower_is_better')).toBe(true);
  });

  it('works with only absolute threshold', () => {
    const r: RegressionRule = { metric: 'p95Latency', absoluteThreshold: 1000, minimumSamples: 20 };
    expect(isImproved(-0.05, -1200, r, 'lower_is_better')).toBe(true);
  });
});

// ===== toMetricSnapshot =====

describe('toMetricSnapshot', () => {
  const metrics = { successRate: 95, failureRate: 5, p95LatencyMs: 3200, estimatedCostPerRun: 0.003 };

  it('extracts all fields correctly', () => {
    const snapshot = toMetricSnapshot(metrics, 85);
    expect(snapshot.successRate).toBe(95);
    expect(snapshot.failureRate).toBe(5);
    expect(snapshot.p95Latency).toBe(3200);
    expect(snapshot.costPerRun).toBe(0.003);
    expect(snapshot.testScore).toBe(85);
  });

  it('defaults testScore to 100 when not provided', () => {
    const snapshot = toMetricSnapshot(metrics);
    expect(snapshot.testScore).toBe(100);
  });
});

// ===== extractMetricValue =====

describe('extractMetricValue', () => {
  const snapshot: MetricSnapshot = { successRate: 95, failureRate: 5, p95Latency: 3200, costPerRun: 0.003, testScore: 85 };

  it('extracts each metric by name', () => {
    expect(extractMetricValue(snapshot, 'successRate')).toBe(95);
    expect(extractMetricValue(snapshot, 'failureRate')).toBe(5);
    expect(extractMetricValue(snapshot, 'p95Latency')).toBe(3200);
    expect(extractMetricValue(snapshot, 'costPerRun')).toBe(0.003);
    expect(extractMetricValue(snapshot, 'testScore')).toBe(85);
  });
});

// ===== METRIC_DEFINITIONS =====

describe('METRIC_DEFINITIONS', () => {
  it('has all 5 metrics', () => {
    expect(Object.keys(METRIC_DEFINITIONS)).toHaveLength(5);
  });

  it('has correct directions', () => {
    expect(METRIC_DEFINITIONS.successRate.direction).toBe('higher_is_better');
    expect(METRIC_DEFINITIONS.failureRate.direction).toBe('lower_is_better');
    expect(METRIC_DEFINITIONS.p95Latency.direction).toBe('lower_is_better');
    expect(METRIC_DEFINITIONS.costPerRun.direction).toBe('lower_is_better');
    expect(METRIC_DEFINITIONS.testScore.direction).toBe('higher_is_better');
  });
});

// ===== ALL_METRIC_NAMES =====

describe('ALL_METRIC_NAMES', () => {
  it('contains all 5 metric names', () => {
    expect(ALL_METRIC_NAMES).toHaveLength(5);
    expect(ALL_METRIC_NAMES).toContain('successRate');
    expect(ALL_METRIC_NAMES).toContain('failureRate');
    expect(ALL_METRIC_NAMES).toContain('p95Latency');
    expect(ALL_METRIC_NAMES).toContain('costPerRun');
    expect(ALL_METRIC_NAMES).toContain('testScore');
  });
});

// ===== DEFAULT_SEVERITY_POLICY =====

describe('DEFAULT_SEVERITY_POLICY', () => {
  it('has thresholds for all 5 metrics', () => {
    for (const name of ALL_METRIC_NAMES) {
      expect(DEFAULT_SEVERITY_POLICY[name]).toBeDefined();
    }
  });

  it('has monotonically increasing thresholds for each metric', () => {
    for (const name of ALL_METRIC_NAMES) {
      const t = DEFAULT_SEVERITY_POLICY[name];
      expect(t.low).toBeLessThan(t.medium);
      expect(t.medium).toBeLessThan(t.high);
      expect(t.high).toBeLessThan(t.critical);
    }
  });
});

// ===== DEFAULT_REGRESSION_RULES =====

describe('DEFAULT_REGRESSION_RULES', () => {
  it('has rules for all 5 metrics', () => {
    expect(DEFAULT_REGRESSION_RULES).toHaveLength(5);
  });

  it('each rule has at least one threshold', () => {
    for (const rule of DEFAULT_REGRESSION_RULES) {
      expect(rule.relativeThreshold !== undefined || rule.absoluteThreshold !== undefined).toBe(true);
    }
  });

  it('each rule has positive minimumSamples', () => {
    for (const rule of DEFAULT_REGRESSION_RULES) {
      expect(rule.minimumSamples).toBeGreaterThan(0);
    }
  });

  it('covers all metric names', () => {
    const covered = new Set(DEFAULT_REGRESSION_RULES.map((r) => r.metric));
    for (const name of ALL_METRIC_NAMES) {
      expect(covered.has(name)).toBe(true);
    }
  });
});
