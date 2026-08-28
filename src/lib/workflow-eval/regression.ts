/**
 * Regression Detector — Phase 3
 *
 * 纯函数层：给定 Baseline + Candidate + Policy，判断 Workflow 是否发生 Regression。
 *
 * 复用：
 *   - regression-policy.ts (MetricSnapshot, MetricName, Severity, RegressionRule,
 *     SeverityPolicy, METRIC_DEFINITIONS, ALL_METRIC_NAMES, DEFAULT_REGRESSION_RULES,
 *     DEFAULT_SEVERITY_POLICY, classifySeverity, maxSeverity, maxSeverityFrom, extractMetricValue)
 *   - baseline.ts (Baseline, BaselineType)
 *
 * 不含：DB / Supabase / API / Scheduler / Event / AI / Proposal。
 */

import type { Baseline, BaselineType } from './baseline';
import type {
  MetricName,
  MetricDirection,
  MetricSnapshot,
  MetricDefinition,
  Severity,
  SeverityThresholds,
  RegressionRule,
  SeverityPolicy,
} from './regression-policy';
import {
  METRIC_DEFINITIONS,
  ALL_METRIC_NAMES,
  DEFAULT_REGRESSION_RULES,
  DEFAULT_SEVERITY_POLICY,
  classifySeverity,
  maxSeverity,
  maxSeverityFrom,
  extractMetricValue,
} from './regression-policy';

// ===== Exported Types =====

export type MetricStatus = 'improved' | 'stable' | 'regressed' | 'inconclusive';
export type OverallStatus = 'improved' | 'stable' | 'regressed' | 'tradeoff' | 'inconclusive';

export interface MetricEvaluation {
  name: MetricName;
  baseline: number;
  candidate: number;
  /** 相对变化（正=增长） */
  delta: number;
  /** delta * 100（显示用）；baseline=0 && candidate!=0 时为 null */
  deltaPercent: number | null;
  /** 绝对变化 */
  absoluteDelta: number;
  status: MetricStatus;
  severity: Severity;
  reason: string;
}

export interface ComparisonTarget {
  version?: number;
  timeRange?: string;
  sampleCount: number;
  metrics: MetricSnapshot;
}

export interface RegressionReport {
  workflowId: string;
  status: OverallStatus;
  baseline: {
    type: BaselineType;
    version?: number;
    timeRange?: string;
    sampleCount: number;
    metrics: MetricSnapshot;
  };
  candidate: ComparisonTarget;
  metrics: MetricEvaluation[];
  overallSeverity: Severity;
  affectedNodes: string[];
  summary: string;
  generatedAt: string;
}

// ===== Core: Metric Evaluation =====

/**
 * 评估单个指标的 regression 状态。
 * 纯函数：相同输入 → 相同输出。
 *
 * Threshold 逻辑：
 *   - regression: OR（任一阈值满足即 regression）
 *   - improvement: AND（保守，两个阈值都满足才算改善）
 *   - 都不满足 → stable
 *   - baseline=0 && candidate=0 → stable
 *   - baseline=0 && candidate!=0 → deltaPercent=null
 */
export function evaluateMetric(
  baselineValue: number,
  candidateValue: number,
  rule: RegressionRule,
  direction: MetricDirection,
  severityPolicy: SeverityThresholds,
): MetricEvaluation {
  const delta = relativeDeltaSafe(baselineValue, candidateValue);
  const absDelta = absoluteDelta(baselineValue, candidateValue);

  // deltaPercent: null when baseline=0 && candidate!=0
  const deltaPercent: number | null =
    baselineValue === 0 && candidateValue !== 0 ? null : delta * 100;

  // 根据指标方向调整符号
  const effectiveDelta = direction === 'lower_is_better' ? delta : -delta;
  const effectiveAbsDelta = direction === 'lower_is_better' ? absDelta : -absDelta;

  // 判断 status
  const status = classifyMetricStatus(effectiveDelta, effectiveAbsDelta, rule);

  // severity: 只有 regressed 才有实质 severity
  const severity = status === 'regressed'
    ? classifySeverity(Math.abs(effectiveAbsDelta), severityPolicy)
    : 'info';

  // reason
  const reason = buildMetricReason(
    baselineValue, candidateValue, deltaPercent, status, direction,
  );

  return {
    name: rule.metric,
    baseline: baselineValue,
    candidate: candidateValue,
    delta,
    deltaPercent,
    absoluteDelta: absDelta,
    status,
    severity,
    reason,
  };
}

/**
 * 单指标 status 判定。
 * regression: OR 逻辑（任一阈值满足）
 * improvement: AND 逻辑（保守）
 */
function classifyMetricStatus(
  effectiveDelta: number,
  effectiveAbsDelta: number,
  rule: RegressionRule,
): MetricStatus {
  const hasRelative = rule.relativeThreshold !== undefined;
  const hasAbsolute = rule.absoluteThreshold !== undefined;

  // 检查 regression（effectiveAbsDelta > 0 = 指标变差）
  if (effectiveAbsDelta > 0) {
    const relMet = hasRelative ? effectiveDelta >= rule.relativeThreshold! : false;
    const absMet = hasAbsolute ? effectiveAbsDelta >= rule.absoluteThreshold! : false;

    if (hasRelative && hasAbsolute) {
      // OR: 任一阈值满足即 regression
      if (relMet || absMet) return 'regressed';
    } else if (hasRelative) {
      if (relMet) return 'regressed';
    } else if (hasAbsolute) {
      if (absMet) return 'regressed';
    }
  }

  // 检查 improvement（effectiveAbsDelta < 0 = 指标变好）
  if (effectiveAbsDelta < 0) {
    const absChange = Math.abs(effectiveAbsDelta);
    const relChange = Math.abs(effectiveDelta);
    const relMet = hasRelative ? relChange >= rule.relativeThreshold! : false;
    const absMet = hasAbsolute ? absChange >= rule.absoluteThreshold! : false;

    if (hasRelative && hasAbsolute) {
      // AND: 两个阈值都满足才算 improvement
      if (relMet && absMet) return 'improved';
    } else if (hasRelative) {
      if (relMet) return 'improved';
    } else if (hasAbsolute) {
      if (absMet) return 'improved';
    }
  }

  return 'stable';
}

// ===== Core: Overall Status =====

/**
 * 从 MetricEvaluation[] 判定整体 status。
 *
 * 规则（按优先级）：
 * 1. regressed + improved → tradeoff
 * 2. regressed → regressed（即使有 stable/inconclusive）
 * 3. improved → improved（即使有 stable/inconclusive）
 * 4. stable → stable
 * 5. 其他 → inconclusive
 */
export function determineOverallStatus(metrics: MetricEvaluation[]): OverallStatus {
  const regressed = metrics.filter((m) => m.status === 'regressed');
  const improved = metrics.filter((m) => m.status === 'improved');
  const stable = metrics.filter((m) => m.status === 'stable');
  const inconclusive = metrics.filter((m) => m.status === 'inconclusive');

  // 1. tradeoff: 同时存在 regressed 和 improved
  if (regressed.length > 0 && improved.length > 0) return 'tradeoff';

  // 2. regressed
  if (regressed.length > 0) return 'regressed';

  // 3. improved
  if (improved.length > 0) return 'improved';

  // 4. stable
  if (stable.length > 0) return 'stable';

  // 5. 全部 inconclusive
  return 'inconclusive';
}

// ===== Core: Summary =====

function buildSummary(status: OverallStatus, metrics: MetricEvaluation[]): string {
  const regressed = metrics.filter((m) => m.status === 'regressed');
  const improved = metrics.filter((m) => m.status === 'improved');

  switch (status) {
    case 'inconclusive':
      return '数据不足，无法判定是否存在退化。';
    case 'stable':
      return '所有指标稳定，未发现退化或改善。';
    case 'improved': {
      const names = improved.map((m) => METRIC_DEFINITIONS[m.name].label).join('、');
      return `指标改善：${names}。`;
    }
    case 'regressed': {
      const names = regressed.map((m) => METRIC_DEFINITIONS[m.name].label).join('、');
      return `检测到退化：${names}。`;
    }
    case 'tradeoff': {
      const regNames = regressed.map((m) => METRIC_DEFINITIONS[m.name].label).join('、');
      const impNames = improved.map((m) => METRIC_DEFINITIONS[m.name].label).join('、');
      return `存在权衡：${regNames} 退化，${impNames} 改善。`;
    }
  }
}

// ===== Entry Point =====

/**
 * 完整 Regression Detection。
 * 纯函数：相同输入 → 相同输出。
 *
 * @param baseline 基线（来自 baseline.ts）
 * @param candidate 候选（来自 Rolling Baseline 或 Version Baseline）
 * @param rules 每指标的 regression rule（默认 DEFAULT_REGRESSION_RULES）
 * @param severityPolicy severity 阈值（默认 DEFAULT_SEVERITY_POLICY）
 */
export function detectRegression(
  baseline: Baseline,
  candidate: ComparisonTarget,
  rules: RegressionRule[] = DEFAULT_REGRESSION_RULES,
  severityPolicy: SeverityPolicy = DEFAULT_SEVERITY_POLICY,
): RegressionReport {
  const metrics: MetricEvaluation[] = [];

  for (const metricName of ALL_METRIC_NAMES) {
    const rule = rules.find((r) => r.metric === metricName);
    if (!rule) continue;

    const definition = METRIC_DEFINITIONS[metricName];
    const baselineVal = extractMetricValue(baseline.metrics, metricName);
    const candidateVal = extractMetricValue(candidate.metrics, metricName);
    const sevThresholds = severityPolicy[metricName];

    // 检查 sample count
    if (baseline.sampleCount < rule.minimumSamples || candidate.sampleCount < rule.minimumSamples) {
      metrics.push({
        name: metricName,
        baseline: baselineVal,
        candidate: candidateVal,
        delta: 0,
        deltaPercent: null,
        absoluteDelta: 0,
        status: 'inconclusive',
        severity: 'info',
        reason: `样本不足（baseline=${baseline.sampleCount}, candidate=${candidate.sampleCount}, 需≥${rule.minimumSamples}）`,
      });
      continue;
    }

    metrics.push(evaluateMetric(baselineVal, candidateVal, rule, definition.direction, sevThresholds));
  }

  const overallStatus = determineOverallStatus(metrics);
  const overallSeverity = maxSeverityFrom(metrics.map((m) => m.severity));

  return {
    workflowId: baseline.workflowId,
    status: overallStatus,
    baseline: {
      type: baseline.type,
      version: baseline.version,
      timeRange: baseline.timeRange,
      sampleCount: baseline.sampleCount,
      metrics: baseline.metrics,
    },
    candidate,
    metrics,
    overallSeverity,
    affectedNodes: [],
    summary: buildSummary(overallStatus, metrics),
    generatedAt: new Date().toISOString(),
  };
}

// ===== Helpers =====

/**
 * 相对变化（安全版：baseline=0 && candidate!=0 时返回特殊值）。
 * 与 regression-policy.ts 的 relativeDelta 不同：这里 baseline=0 && candidate!=0 时
 * 返回 Infinity/-Infinity（供内部判断用），但 deltaPercent 对外输出 null。
 */
function relativeDeltaSafe(baseline: number, current: number): number {
  if (baseline === 0) {
    if (current === 0) return 0;
    // baseline=0, candidate>0: 返回一个大值表示"从无到有"
    // 方向由调用者通过 effectiveDelta 处理
    return current > 0 ? Infinity : -Infinity;
  }
  return (current - baseline) / baseline;
}

function absoluteDelta(baseline: number, current: number): number {
  return current - baseline;
}

function buildMetricReason(
  baseline: number,
  candidate: number,
  deltaPercent: number | null,
  status: MetricStatus,
  direction: MetricDirection,
): string {
  const fmtVal = (v: number) => v % 1 === 0 ? v.toString() : v.toFixed(2);

  if (baseline === 0 && candidate === 0) return '无变化';
  if (baseline === 0 && candidate !== 0) {
    const dir = direction === 'lower_is_better' ? '退化' : '改善';
    return `基线为0，${dir}（绝对值 ${fmtVal(candidate)}），相对变化不适用`;
  }

  const pctStr = deltaPercent !== null ? `${deltaPercent >= 0 ? '+' : ''}${deltaPercent.toFixed(1)}%` : 'N/A';
  const absStr = `${candidate >= baseline ? '+' : ''}${fmtVal(candidate - baseline)}`;

  switch (status) {
    case 'regressed': return `退化 ${pctStr}（${fmtVal(baseline)} → ${fmtVal(candidate)}，绝对变化 ${absStr}）`;
    case 'improved': return `改善 ${pctStr}（${fmtVal(baseline)} → ${fmtVal(candidate)}）`;
    case 'stable': return `稳定（变化 ${pctStr}，在阈值范围内）`;
    case 'inconclusive': return '数据不足';
  }
}
