/**
 * Quality Gate — Static Analysis Check
 *
 * 复用 workflow-eval/static-analysis.ts 的 analyzeWorkflow。
 * 检查 error / warning 数量是否超过阈值。
 */

import { analyzeWorkflow } from '@/lib/workflow-eval/static-analysis';
import type { GateCheckResult } from '../evaluator';
import type { TinyflowData } from '@/lib/tinyflow/types';

export function checkStaticAnalysis(
  data: TinyflowData,
  maxErrors: number = 0,
): GateCheckResult {
  const start = Date.now();
  const result = analyzeWorkflow(data);
  const durationMs = Date.now() - start;

  const errors = result.findings.filter((f) => f.severity === 'error');
  const warnings = result.findings.filter((f) => f.severity === 'warning');

  if (errors.length > maxErrors) {
    return {
      name: 'static_analysis',
      level: 'required',
      status: 'fail',
      message: `静态分析发现 ${errors.length} 个错误（阈值 ${maxErrors}）：${errors.map((e) => e.message).join('；')}`,
      details: { errors, warnings, parallelizable: result.parallelizable },
      durationMs,
    };
  }

  if (warnings.length > 0) {
    return {
      name: 'static_analysis',
      level: 'required',
      status: 'warn',
      message: `静态分析发现 ${warnings.length} 个警告`,
      details: { errors, warnings, parallelizable: result.parallelizable },
      durationMs,
    };
  }

  return {
    name: 'static_analysis',
    level: 'required',
    status: 'pass',
    message: '静态分析通过',
    details: { findings: result.findings, parallelizable: result.parallelizable },
    durationMs,
  };
}
