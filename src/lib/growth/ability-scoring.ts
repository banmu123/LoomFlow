import type { AbilityScores, AbilityDimension } from './ability-types';
import { DIMENSIONS, emptyScores } from './ability-types';

// ===== 评分引擎（纯函数，不依赖数据库）=====
// 每个维度由多个来源加权计算 0-100 分

export interface AnswerStats {
  correct: number;
  total: number;
}

export interface DimensionSourceData {
  answers: AnswerStats;
  checkinDays: number;
  workflowScore: number;
}

export type AllDimensionSources = Record<AbilityDimension, DimensionSourceData>;

const WEIGHTS = {
  answers: 0.40,
  checkin: 0.30,
  workflow: 0.30,
};

const FULL_ANSWERS = 10;
const FULL_CHECKIN_DAYS = 7;

/** 计算单个维度的分数 (0-100) */
export function calculateDimensionScore(data: DimensionSourceData): number {
  const answerScore = Math.min(data.answers.correct / FULL_ANSWERS, 1.0);
  const checkinScore = Math.min(data.checkinDays / FULL_CHECKIN_DAYS, 1.0);
  const workflowScore = Math.min(data.workflowScore, 1.0);

  const raw =
    answerScore * WEIGHTS.answers +
    checkinScore * WEIGHTS.checkin +
    workflowScore * WEIGHTS.workflow;

  return scoreToPercent(raw * 100);
}

function scoreToPercent(raw: number): number {
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/** 计算全部六维分数 */
export function calculateAllScores(sources: AllDimensionSources): AbilityScores {
  const scores = emptyScores();
  for (const dim of DIMENSIONS) {
    scores[dim] = calculateDimensionScore(sources[dim]);
  }
  return scores;
}

/** 计算分数标准差（用于判断是否全栈型人） */
export function calculateStdDev(scores: AbilityScores): number {
  const values = DIMENSIONS.map((d) => scores[d]);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** 获取 top N 维度（按分数降序） */
export function getTopDimensions(scores: AbilityScores, n: number): AbilityDimension[] {
  return [...DIMENSIONS].sort((a, b) => scores[b] - scores[a]).slice(0, n);
}

/** 获取最弱维度 */
export function getWeakestDimension(scores: AbilityScores): AbilityDimension {
  return [...DIMENSIONS].sort((a, b) => scores[a] - scores[b])[0];
}

/** 构建答题统计（从答题记录聚合） */
export function buildAnswerStats(
  records: Array<{ dimension: string; is_correct: boolean }>,
): Record<AbilityDimension, AnswerStats> {
  const stats: Record<AbilityDimension, AnswerStats> = {} as Record<AbilityDimension, AnswerStats>;
  for (const dim of DIMENSIONS) {
    stats[dim] = { correct: 0, total: 0 };
  }
  for (const r of records) {
    if ((DIMENSIONS as readonly string[]).includes(r.dimension)) {
      const d = r.dimension as AbilityDimension;
      stats[d].total++;
      if (r.is_correct) stats[d].correct++;
    }
  }
  return stats;
}
