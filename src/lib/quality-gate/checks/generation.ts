/**
 * Quality Gate — Generation Eval Check
 *
 * 复用 workflow-gen-eval 的报告，不重新计算。
 * 默认建议 advisory：生成质量差通常应先告警，而不是阻断所有发布；
 * 是否阻断由 policy.generationEval.level / blockBelowScore 决定。
 */

import type { GenerationReport } from '@/lib/workflow-gen-eval';
import type { GateCheckResult } from '../evaluator';
import type { QualityGatePolicy } from '../policy';

export function checkGeneration(
  report: GenerationReport | null,
  policy: NonNullable<QualityGatePolicy['generationEval']>,
): GateCheckResult {
  const start = Date.now();

  if (!report) {
    return {
      name: 'generationEval',
      level: policy.level,
      status: 'skip',
      message: '未提供生成评测报告，跳过',
      durationMs: Date.now() - start,
    };
  }

  const score = report.aggregate.averageScore;
  const blockBelow = policy.blockBelowScore ?? 60;
  const details = {
    suiteVersion: report.suiteVersion,
    promptVersion: report.promptVersion,
    modelId: report.modelId,
    temperature: report.temperature,
    score,
    decision: report.decision,
    schemaValidity: report.aggregate.schemaValidity,
    taskCompletionRate: report.aggregate.taskCompletionRate,
  };

  if (report.decision === 'block' || score < blockBelow) {
    return {
      name: 'generationEval',
      level: policy.level,
      status: 'fail',
      message: `生成评测未达标（均分 ${score}，报告结论 ${report.decision}）`,
      details,
      durationMs: Date.now() - start,
    };
  }

  if (report.decision === 'warning') {
    return {
      name: 'generationEval',
      level: policy.level,
      status: 'warn',
      message: `生成评测存在告警（均分 ${score}）`,
      details,
      durationMs: Date.now() - start,
    };
  }

  return {
    name: 'generationEval',
    level: policy.level,
    status: 'pass',
    message: `生成评测通过（均分 ${score}）`,
    details,
    durationMs: Date.now() - start,
  };
}
