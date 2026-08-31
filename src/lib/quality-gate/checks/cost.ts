/**
 * Quality Gate — Cost Check
 *
 * 纯阈值判定。
 * cost unavailable（=0 且 baseline=0）→ skip。
 */

import type { GateCheckResult } from '../evaluator';
import type { MetricSnapshot } from '@/lib/workflow-eval/regression-policy';

export function checkCost(
  candidateMetrics: MetricSnapshot,
  baselineMetrics?: MetricSnapshot | null,
  maxCostPerRun?: number,
): GateCheckResult {
  const cost = candidateMetrics.costPerRun;
  const baselineCost = baselineMetrics?.costPerRun ?? 0;

  // cost unavailable
  if (cost === 0 && baselineCost === 0) {
    return {
      name: 'cost',
      level: 'advisory',
      status: 'skip',
      message: '成本数据不可用',
      durationMs: 0,
    };
  }

  if (maxCostPerRun !== undefined && cost > maxCostPerRun) {
    return {
      name: 'cost',
      level: 'advisory',
      status: 'warn',
      message: `单次成本 $${cost.toFixed(4)} 超过阈值 $${maxCostPerRun}`,
      details: { cost, maxCostPerRun },
      durationMs: 0,
    };
  }

  return {
    name: 'cost',
    level: 'advisory',
    status: 'pass',
    message: `单次成本 $${cost.toFixed(4)}`,
    details: { cost },
    durationMs: 0,
  };
}
