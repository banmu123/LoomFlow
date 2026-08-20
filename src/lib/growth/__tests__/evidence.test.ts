import { describe, it, expect } from 'vitest';
import { emptyEvidence, EVIDENCE_SOURCES } from '../evidence';
import { evaluateCapability, evaluateJourneyCapabilities, getEvidenceRule } from '../engine';
import { inferEvidenceRule } from '../ai-generate';
import type { Capability } from '../types';
import type { EvidenceSummary } from '../evidence';

function makeCap(overrides: Partial<Capability> = {}): Capability {
  return {
    id: 'c1',
    journey_id: 'j1',
    user_id: 'u1',
    title: 'Workflow 编排',
    description: null,
    order: 0,
    status: 'locked',
    prerequisites: [],
    metadata: {},
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('evidence 证据源', () => {
  it('证据源枚举完整（全部从现有表推导）', () => {
    expect(EVIDENCE_SOURCES).toContain('workflow_created');
    expect(EVIDENCE_SOURCES).toContain('workflow_executed_success');
    expect(EVIDENCE_SOURCES).toContain('api_published');
    expect(EVIDENCE_SOURCES).toContain('notes');
  });

  it('emptyEvidence 全零', () => {
    const e = emptyEvidence();
    expect(Object.values(e).every((v) => v === 0)).toBe(true);
    expect(Object.keys(e)).toHaveLength(EVIDENCE_SOURCES.length);
  });
});

describe('evidence rule 推断与读取', () => {
  it('按标题推断规则', () => {
    expect(inferEvidenceRule('Workflow Composition')).toEqual({
      source: 'workflow_executed_success',
      threshold: 3,
    });
    expect(inferEvidenceRule('Debugging')).toEqual({
      source: 'workflow_executed_success',
      threshold: 3,
    });
    expect(inferEvidenceRule('REST API')).toEqual({ source: 'api_published', threshold: 1 });
    expect(inferEvidenceRule('定时任务')).toEqual({ source: 'schedule_created', threshold: 1 });
    expect(inferEvidenceRule('RAG 知识库')).toEqual({ source: 'notes', threshold: 3 });
    expect(inferEvidenceRule('Java 基础')).toEqual({ source: 'workflow_created', threshold: 2 });
  });

  it('getEvidenceRule 读取与容错', () => {
    const cap = makeCap({ metadata: { evidence_rule: { source: 'notes', threshold: 2 } } });
    expect(getEvidenceRule(cap)).toEqual({ source: 'notes', threshold: 2 });
    expect(getEvidenceRule(makeCap())).toBeNull();
    expect(
      getEvidenceRule(makeCap({ metadata: { evidence_rule: { source: 'x', threshold: 0 } } })),
    ).toBeNull();
  });
});

describe('evaluateCapability 评估（Evidence → Status）', () => {
  const rule = makeCap({ metadata: { evidence_rule: { source: 'workflow_executed_success', threshold: 3 } } });

  function ev(count: number): EvidenceSummary {
    return { ...emptyEvidence(), workflow_executed_success: count };
  }

  it('达标 → mastered', () => {
    expect(evaluateCapability(rule, ev(3))).toBe('mastered');
    expect(evaluateCapability(rule, ev(10))).toBe('mastered');
  });

  it('半阈值 → developing；有记录 → exploring；无 → locked', () => {
    expect(evaluateCapability(rule, ev(2))).toBe('developing');
    expect(evaluateCapability(rule, ev(1))).toBe('exploring');
    expect(evaluateCapability(rule, ev(0))).toBe('locked');
  });

  it('无规则不自动修改状态', () => {
    const noRule = makeCap({ status: 'locked' });
    expect(evaluateCapability(noRule, ev(10))).toBe('locked');
  });

  it('已掌握不倒退', () => {
    const mastered = makeCap({ status: 'mastered', metadata: { evidence_rule: { source: 'notes', threshold: 5 } } });
    expect(evaluateCapability(mastered, { ...emptyEvidence(), notes: 0 })).toBe('mastered');
  });
});

describe('evaluateJourneyCapabilities 批量评估', () => {
  it('返回变更列表', () => {
    const caps = [
      makeCap({ id: 'a', metadata: { evidence_rule: { source: 'workflow_created', threshold: 1 } } }),
      makeCap({ id: 'b', status: 'mastered', metadata: { evidence_rule: { source: 'notes', threshold: 1 } } }),
    ];
    const evidence: EvidenceSummary = { ...emptyEvidence(), workflow_created: 2, notes: 0 };
    const changes = evaluateJourneyCapabilities(caps, evidence);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ capabilityId: 'a', from: 'locked', to: 'mastered' });
  });
});
