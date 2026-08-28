/**
 * Regression Detection — Policy Configuration
 *
 * 纯配置 + 纯函数：
 *   - 指标定义（名称、方向、格式）
 *   - Severity 阈值（可配置 Policy）
 *   - 默认 Regression Rules
 *   - Severity 判定函数
 *
 * 不含：DB 查询 / HTTP / AI 调用。
 */

// ===== Metric Definitions =====

export type MetricName = 'successRate' | 'failureRate' | 'p95Latency' | 'costPerRun' | 'testScore';

export type MetricDirection = 'lower_is_better' | 'higher_is_better';

export interface MetricDefinition {
  name: MetricName;
  label: string;
  direction: MetricDirection;
  unit: 'percent' | 'ms' | 'usd' | 'score';
}

/** 5 个受支持指标的完整定义 */
export const METRIC_DEFINITIONS: Record<MetricName, MetricDefinition> = {
  successRate: { name: 'successRate', label: 'Success Rate', direction: 'higher_is_better', unit: 'percent' },
  failureRate: { name: 'failureRate', label: 'Failure Rate', direction: 'lower_is_better', unit: 'percent' },
  p95Latency:  { name: 'p95Latency',  label: 'P95 Latency',  direction: 'lower_is_better', unit: 'ms' },
  costPerRun:  { name: 'costPerRun',  label: 'Cost Per Run',  direction: 'lower_is_better', unit: 'usd' },
  testScore:   { name: 'testScore',   label: 'Test Score',    direction: 'higher_is_better', unit: 'score' },
};

/** 所有指标名称列表（遍历用） */
export const ALL_METRIC_NAMES: MetricName[] = Object.keys(METRIC_DEFINITIONS) as MetricName[];

// ===== Metric Snapshot =====

/**
 * 指标快照：从 WorkflowMetrics 提取的 5 个受支持指标值。
 * baseline.ts 构建，regression.ts 消费，Quality Gate 后续复用。
 */
export interface MetricSnapshot {
  successRate: number;
  failureRate: number;
  p95Latency: number;
  costPerRun: number;
  testScore: number;
}

/**
 * 从 WorkflowMetrics 提取 MetricSnapshot。
 * 唯一的 WorkflowMetrics → MetricSnapshot 转换点。
 */
export function toMetricSnapshot(
  metrics: { successRate: number; failureRate: number; p95LatencyMs: number; estimatedCostPerRun: number },
  testScore?: number,
): MetricSnapshot {
  return {
    successRate: metrics.successRate,
    failureRate: metrics.failureRate,
    p95Latency: metrics.p95LatencyMs,
    costPerRun: metrics.estimatedCostPerRun,
    testScore: testScore ?? 100,
  };
}

/**
 * 从 MetricSnapshot 提取单个指标值。
 */
export function extractMetricValue(snapshot: MetricSnapshot, metric: MetricName): number {
  return snapshot[metric];
}

// ===== Severity Levels =====

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

/** Severity 严重程度排序（用于 overallSeverity 取最高） */
export const SEVERITY_ORDER: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

// ===== Severity Policy =====

/**
 * 每个指标的 Severity 阈值。
 * 值为 delta 的绝对值（如 0.3 = 30%，1000 = 1000ms）。
 * 当 |delta| >= threshold 时，severity 至少为该级别。
 */
export interface SeverityThresholds {
  low: number;
  medium: number;
  high: number;
  critical: number;
}

export type SeverityPolicy = Record<MetricName, SeverityThresholds>;

/** 默认 Severity Policy */
export const DEFAULT_SEVERITY_POLICY: SeverityPolicy = {
  successRate: { low: 0.03, medium: 0.08, high: 0.15, critical: 0.30 },
  failureRate: { low: 0.05, medium: 0.15, high: 0.30, critical: 0.50 },
  p95Latency:  { low: 0.10, medium: 0.30, high: 0.50, critical: 1.00 },
  costPerRun:  { low: 0.15, medium: 0.30, high: 0.50, critical: 1.00 },
  testScore:   { low: 5,    medium: 15,   high: 30,   critical: 50   },
};

// ===== Regression Rule =====

/**
 * 单条 Regression Rule：定义一个指标的检测规则。
 * 用于 Regression Detector 逐指标判断。
 */
export interface RegressionRule {
  metric: MetricName;
  /** relativeThreshold: 如 0.3 = 30% */
  relativeThreshold?: number;
  /** absoluteThreshold: 绝对值（ms / $ / 分） */
  absoluteThreshold?: number;
  /** 最小样本数，低于此值返回 inconclusive */
  minimumSamples: number;
}

/** 默认 Regression Rules（5 个指标） */
export const DEFAULT_REGRESSION_RULES: RegressionRule[] = [
  { metric: 'successRate', relativeThreshold: 0.05, absoluteThreshold: 3,  minimumSamples: 20 },
  { metric: 'failureRate', relativeThreshold: 0.30, absoluteThreshold: 5,  minimumSamples: 20 },
  { metric: 'p95Latency',  relativeThreshold: 0.30, absoluteThreshold: 1000, minimumSamples: 20 },
  { metric: 'costPerRun',  relativeThreshold: 0.30, absoluteThreshold: 0.005, minimumSamples: 20 },
  { metric: 'testScore',   relativeThreshold: 0.10, absoluteThreshold: 10, minimumSamples: 5 },
];

// ===== Pure Functions =====

/**
 * 判断 delta 的 severity。
 * @param absDelta 变化量的绝对值
 * @param thresholds 该指标的 severity 阈值
 * @returns severity 级别
 */
export function classifySeverity(absDelta: number, thresholds: SeverityThresholds): Severity {
  if (absDelta >= thresholds.critical) return 'critical';
  if (absDelta >= thresholds.high) return 'high';
  if (absDelta >= thresholds.medium) return 'medium';
  if (absDelta >= thresholds.low) return 'low';
  return 'info';
}

/**
 * 计算两个 severity 中更高的那个。
 */
export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b;
}

/**
 * 从 severity 列表中取最高 severity。
 */
export function maxSeverityFrom(severities: Severity[]): Severity {
  return severities.reduce<Severity>((max, s) => maxSeverity(max, s), 'info');
}

/**
 * 计算相对变化百分比。
 * baseline=0 时返回 0（避免除零）。
 */
export function relativeDelta(baseline: number, current: number): number {
  if (baseline === 0) return 0;
  return (current - baseline) / baseline;
}

/**
 * 计算绝对变化。
 */
export function absoluteDelta(baseline: number, current: number): number {
  return current - baseline;
}

/**
 * 判断某个指标的 delta 是否满足 regression 条件。
 * 需要同时满足 relativeThreshold 和 absoluteThreshold（如果都配置了）。
 *
 * @param delta 相对变化（正=增长，负=下降）
 * @param absDelta 绝对变化
 * @param rule 该指标的 regression rule
 * @param direction 指标方向（lower_is_better / higher_is_better）
 * @returns 是否 regression
 */
export function isRegressed(
  delta: number,
  absDelta: number,
  rule: RegressionRule,
  direction: MetricDirection,
): boolean {
  // 根据指标方向调整符号：lower_is_better 的指标增长 = 退化
  const effectiveDelta = direction === 'lower_is_better' ? delta : -delta;
  const effectiveAbsDelta = direction === 'lower_is_better' ? absDelta : -absDelta;

  // 需要 effectiveAbsDelta > 0 才算退化（指标变差）
  if (effectiveAbsDelta <= 0) return false;

  const hasRelative = rule.relativeThreshold !== undefined;
  const hasAbsolute = rule.absoluteThreshold !== undefined;

  // 两个阈值都配置了：需要同时满足
  if (hasRelative && hasAbsolute) {
    return effectiveDelta >= rule.relativeThreshold! && effectiveAbsDelta >= rule.absoluteThreshold!;
  }

  // 只配了 relative
  if (hasRelative) {
    return effectiveDelta >= rule.relativeThreshold!;
  }

  // 只配了 absolute
  if (hasAbsolute) {
    return effectiveAbsDelta >= rule.absoluteThreshold!;
  }

  // 都没配：不判定 regression
  return false;
}

/**
 * 判断某个指标是否改善。
 * 与 isRegressed 相反方向。
 */
export function isImproved(
  delta: number,
  absDelta: number,
  rule: RegressionRule,
  direction: MetricDirection,
): boolean {
  const effectiveDelta = direction === 'lower_is_better' ? delta : -delta;
  const effectiveAbsDelta = direction === 'lower_is_better' ? absDelta : -absDelta;

  // effectiveAbsDelta < 0 = 指标变好
  if (effectiveAbsDelta >= 0) return false;

  const hasRelative = rule.relativeThreshold !== undefined;
  const hasAbsolute = rule.absoluteThreshold !== undefined;
  const absChange = Math.abs(effectiveAbsDelta);
  const relChange = Math.abs(effectiveDelta);

  if (hasRelative && hasAbsolute) {
    return relChange >= rule.relativeThreshold! && absChange >= rule.absoluteThreshold!;
  }
  if (hasRelative) return relChange >= rule.relativeThreshold!;
  if (hasAbsolute) return absChange >= rule.absoluteThreshold!;
  return false;
}
