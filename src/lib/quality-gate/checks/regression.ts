/**
 * Quality Gate — Regression Check
 *
 * 复用 workflow-eval/regression.ts 的 detectRegression。
 * Regression 层只提供数据，Quality Gate Policy 决定映射。
 */

import type { GateCheckResult } from '../evaluator';
import type { RegressionReport } from '@/lib/workflow-eval/regression';
import type { Severity } from '@/lib/workflow-eval/regression-policy';

export function checkRegression(
  report: RegressionReport | null,
  options: { blockOnCritical?: boolean } = {},
): GateCheckResult {
  const { blockOnCritical = false } = options;

  if (!report) {
    return {
      name: 'regression',
      level: 'advisory',
      status: 'skip',
      message: '回归检测数据不可用',
      durationMs: 0,
    };
  }

  // Policy 决定 severity → check status 映射
  if (report.status === 'regressed' || report.status === 'tradeoff') {
    if (blockOnCritical && report.overallSeverity === 'critical') {
      return {
        name: 'regression',
        level: 'advisory',
        status: 'fail',
        message: `检测到严重退化（critical）：${report.summary}`,
        details: report,
        durationMs: 0,
      };
    }

    return {
      name: 'regression',
      level: 'advisory',
      status: 'warn',
      message: report.summary,
      details: report,
      durationMs: 0,
    };
  }

  return {
    name: 'regression',
    level: 'advisory',
    status: 'pass',
    message: report.summary,
    details: report,
    durationMs: 0,
  };
}
