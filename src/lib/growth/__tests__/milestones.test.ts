import { describe, it, expect } from 'vitest';
import { evaluateMilestones, MILESTONE_TYPES } from '../milestones';
import type { MilestoneContext } from '../milestones';

function makeCtx(overrides: Partial<MilestoneContext> = {}): MilestoneContext {
  return {
    hasNotes: false,
    hasSavedWorkflow: false,
    hasAiGeneratedWorkflow: false,
    hasComplexWorkflow: false,
    hasDebugRecovery: false,
    hasSchedule: false,
    evidenceNote: '',
    refWorkflowId: null,
    ...overrides,
  };
}

describe('evaluateMilestones 判定', () => {
  it('无任何行为不达成任何里程碑', () => {
    expect(evaluateMilestones(makeCtx())).toEqual([]);
  });

  it('首次写笔记 → First Brew', () => {
    expect(evaluateMilestones(makeCtx({ hasNotes: true }))).toContain('first_brew');
  });

  it('保存工作流 → First Recipe（含 AI 生成关联 → AI Creator）', () => {
    const ctx = makeCtx({ hasSavedWorkflow: true });
    const achieved = evaluateMilestones(ctx);
    expect(achieved).toContain('first_recipe');
    expect(achieved).not.toContain('ai_creator');
    expect(evaluateMilestones(makeCtx({ hasSavedWorkflow: true, hasAiGeneratedWorkflow: true }))).toContain('ai_creator');
  });

  it('3+ 节点工作流 → Workflow Builder', () => {
    expect(evaluateMilestones(makeCtx({ hasComplexWorkflow: true }))).toContain('workflow_builder');
  });

  it('同一工作流失败后成功 → Debugger', () => {
    expect(evaluateMilestones(makeCtx({ hasDebugRecovery: true }))).toContain('debugger');
  });

  it('创建定时任务 → Automator', () => {
    expect(evaluateMilestones(makeCtx({ hasSchedule: true }))).toContain('automator');
  });

  it('全部行为 → 六项全达成（无 XP/等级概念）', () => {
    const achieved = evaluateMilestones(
      makeCtx({
        hasNotes: true,
        hasSavedWorkflow: true,
        hasAiGeneratedWorkflow: true,
        hasComplexWorkflow: true,
        hasDebugRecovery: true,
        hasSchedule: true,
      }),
    );
    expect(achieved).toHaveLength(MILESTONE_TYPES.length);
    expect(MILESTONE_TYPES).toContain('first_brew');
    expect(MILESTONE_TYPES).toHaveLength(6);
  });
});
