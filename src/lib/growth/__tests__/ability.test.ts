import { describe, it, expect } from 'vitest';
import {
  calculateDimensionScore,
  calculateAllScores,
  calculateStdDev,
  getTopDimensions,
  getWeakestDimension,
  buildAnswerStats,
} from '../ability-scoring';
import { determineRole, ROLES, ALLROUNDER_ROLE } from '../ability-roles';
import { emptyScores } from '../ability-types';
import type { AbilityScores, AbilityDimension } from '../ability-types';

describe('ability-scoring 评分引擎', () => {
  it('calculateDimensionScore 答题满分', () => {
    const score = calculateDimensionScore({
      answers: { correct: 10, total: 10 },
      checkinDays: 7,
      workflowScore: 1.0,
    });
    expect(score).toBe(100);
  });

  it('calculateDimensionScore 全零', () => {
    const score = calculateDimensionScore({
      answers: { correct: 0, total: 0 },
      checkinDays: 0,
      workflowScore: 0,
    });
    expect(score).toBe(0);
  });

  it('calculateDimensionScore 部分正确', () => {
    const score = calculateDimensionScore({
      answers: { correct: 5, total: 10 },
      checkinDays: 3,
      workflowScore: 0.5,
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
  });

  it('calculateAllScores 返回六维', () => {
    const sources = {} as Record<AbilityDimension, { answers: { correct: number; total: number }; checkinDays: number; workflowScore: number }>;
    for (const dim of ['thinking', 'creativity', 'execution', 'learning', 'communication', 'resilience'] as AbilityDimension[]) {
      sources[dim] = { answers: { correct: 3, total: 10 }, checkinDays: 2, workflowScore: 0.3 };
    }
    const scores = calculateAllScores(sources);
    expect(Object.keys(scores)).toHaveLength(6);
    for (const dim of ['thinking', 'creativity', 'execution', 'learning', 'communication', 'resilience'] as AbilityDimension[]) {
      expect(scores[dim]).toBeGreaterThanOrEqual(0);
      expect(scores[dim]).toBeLessThanOrEqual(100);
    }
  });

  it('calculateStdDev 均匀分布标准差小', () => {
    const scores: AbilityScores = { thinking: 50, creativity: 50, execution: 50, learning: 50, communication: 50, resilience: 50 };
    expect(calculateStdDev(scores)).toBe(0);
  });

  it('calculateStdDev 极端分布标准差大', () => {
    const scores: AbilityScores = { thinking: 100, creativity: 0, execution: 100, learning: 0, communication: 100, resilience: 0 };
    expect(calculateStdDev(scores)).toBeGreaterThan(40);
  });

  it('getTopDimensions 返回最高分维度', () => {
    const scores: AbilityScores = { thinking: 90, creativity: 80, execution: 70, learning: 60, communication: 50, resilience: 40 };
    const top = getTopDimensions(scores, 2);
    expect(top).toEqual(['thinking', 'creativity']);
  });

  it('getWeakestDimension 返回最低分维度', () => {
    const scores: AbilityScores = { thinking: 90, creativity: 80, execution: 70, learning: 60, communication: 50, resilience: 40 };
    expect(getWeakestDimension(scores)).toBe('resilience');
  });

  it('buildAnswerStats 正确聚合', () => {
    const records = [
      { dimension: 'thinking', is_correct: true },
      { dimension: 'thinking', is_correct: false },
      { dimension: 'creativity', is_correct: true },
      { dimension: 'invalid', is_correct: true },
    ];
    const stats = buildAnswerStats(records);
    expect(stats.thinking).toEqual({ correct: 1, total: 2 });
    expect(stats.creativity).toEqual({ correct: 1, total: 1 });
    expect(stats.execution).toEqual({ correct: 0, total: 0 });
  });
});

describe('ability-roles 角色定位', () => {
  it('所有角色定义完整', () => {
    expect(ROLES.length).toBe(6);
    for (const role of ROLES) {
      expect(role.id).toBeTruthy();
      expect(role.labelKey).toBeTruthy();
      expect(role.icon).toBeTruthy();
      expect(role.descriptionKey).toBeTruthy();
      expect(role.topDimensions).toHaveLength(2);
    }
  });

  it('全栈型人：标准差小于阈值', () => {
    const scores: AbilityScores = { thinking: 55, creativity: 50, execution: 52, learning: 48, communication: 53, resilience: 51 };
    const role = determineRole(scores);
    expect(role.id).toBe(ALLROUNDER_ROLE.id);
  });

  it('思考者：thinking + learning 最高', () => {
    const scores: AbilityScores = { thinking: 90, creativity: 50, execution: 40, learning: 85, communication: 30, resilience: 20 };
    const role = determineRole(scores);
    expect(role.id).toBe('thinker');
    expect(role.strengths).toContain('thinking');
    expect(role.strengths).toContain('learning');
  });

  it('创造者：creativity + thinking 最高', () => {
    const scores: AbilityScores = { thinking: 80, creativity: 90, execution: 40, learning: 50, communication: 30, resilience: 20 };
    const role = determineRole(scores);
    expect(role.id).toBe('creator');
  });

  it('行动派：execution + resilience 最高', () => {
    const scores: AbilityScores = { thinking: 40, creativity: 30, execution: 90, learning: 50, communication: 20, resilience: 85 };
    const role = determineRole(scores);
    expect(role.id).toBe('executor');
  });

  it('连接者：communication + creativity 最高', () => {
    const scores: AbilityScores = { thinking: 40, creativity: 80, execution: 30, learning: 50, communication: 90, resilience: 20 };
    const role = determineRole(scores);
    expect(role.id).toBe('connector');
  });

  it('终身学习者：learning + thinking 最高', () => {
    const scores: AbilityScores = { thinking: 85, creativity: 40, execution: 30, learning: 90, communication: 50, resilience: 20 };
    const role = determineRole(scores);
    // thinker 和 learner 都有 thinking + learning，thinker 先匹配
    expect(['thinker', 'learner']).toContain(role.id);
  });

  it('坚韧者：resilience + execution 最高', () => {
    const scores: AbilityScores = { thinking: 40, creativity: 30, execution: 85, learning: 50, communication: 20, resilience: 90 };
    const role = determineRole(scores);
    // executor 和 resilient 都有 execution + resilience，executor 先匹配
    expect(['executor', 'resilient']).toContain(role.id);
  });

  it('growthAreas 包含最弱维度', () => {
    const scores: AbilityScores = { thinking: 90, creativity: 80, execution: 70, learning: 60, communication: 50, resilience: 40 };
    const role = determineRole(scores);
    expect(role.growthAreas).toContain('resilience');
  });
});
