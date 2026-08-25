/**
 * Skill Evaluation（Skill Quality）
 *
 * 基于历史执行与测试结果计算质量指标：
 *   success rate / latency / token usage / cost / test pass rate / error rate → Quality Score + Risk
 */

import type { SkillQuality } from './skill-types';

const COST_PROMPT_PER_1K = 0.002;
const COST_COMPLETION_PER_1K = 0.006;

export interface MetricRaw {
  totalRuns: number;
  successRuns: number;
  errorRuns: number;
  durationsMs: number[];
  tokenUsages: number[];
  costs: number[];
  testRuns: { passed: number; total: number };
}

/** 估算单次成本（如 token 拆分未知，按非内容 token 计） */
export function estimateCost(totalTokens: number): number {
  // 粗估：约 1/3 completion，其余 prompt
  const completion = totalTokens / 3;
  const prompt = totalTokens - completion;
  return (prompt / 1000) * COST_PROMPT_PER_1K + (completion / 1000) * COST_COMPLETION_PER_1K;
}

const avg = (arr: number[]): number => (arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length);

export function computeSkillQuality(raw: MetricRaw): SkillQuality {
  const totalRuns = raw.totalRuns;
  const successRate = totalRuns === 0 ? 100 : (raw.successRuns / totalRuns) * 100;
  const errorRate = totalRuns === 0 ? 0 : (raw.errorRuns / totalRuns) * 100;
  const latencyMs = avg(raw.durationsMs);
  const tokenUsage = avg(raw.tokenUsages);
  const estimatedCost = avg(raw.costs);
  const testPassRate =
    raw.testRuns.total === 0 ? 100 : (raw.testRuns.passed / raw.testRuns.total) * 100;

  // 综合质量分（加权）
  const scoreSuccess = Math.min(100, successRate);
  const scoreLatency = latencyMs <= 1000 ? 100 : Math.max(0, 100 - (latencyMs - 1000) / 100);
  const scoreTest = testPassRate;
  const qualityScore = Math.round(
    scoreSuccess * 0.5 + scoreLatency * 0.2 + scoreTest * 0.3,
  );

  // 风险
  let risk: SkillQuality['risk'] = 'low';
  if (errorRate > 20 || testPassRate < 60) risk = 'high';
  else if (errorRate > 5 || testPassRate < 90) risk = 'medium';

  return {
    successRate: Math.round(successRate * 10) / 10,
    latencyMs: Math.round(latencyMs),
    tokenUsage: Math.round(tokenUsage),
    estimatedCost: Math.round(estimatedCost * 10000) / 10000,
    testPassRate: Math.round(testPassRate * 10) / 10,
    errorRate: Math.round(errorRate * 10) / 10,
    qualityScore,
    risk,
    totalRuns,
  };
}

/** 生成改进建议（基于指标，确定性规则；后续可由 AI 增强） */
export function buildImprovements(q: SkillQuality): string[] {
  const items: string[] = [];
  if (q.errorRate > 10) items.push(`错误率偏高（${q.errorRate}%），建议检查失败节点的错误处理与重试策略`);
  if (q.latencyMs > 5000) items.push(`平均耗时 ${q.latencyMs}ms，可检查是否可并行化或精简 LLM 调用`);
  if (q.testPassRate < 100) items.push(`测试通过率 ${q.testPassRate}%，建议补充/修复测试用例后发布`);
  if (q.tokenUsage > 2000) items.push(`token 消耗偏高（平均 ${q.tokenUsage}），可精简提示词或输出`);
  if (items.length === 0) items.push('运行状态良好，当前无需明显改进');
  return items;
}
