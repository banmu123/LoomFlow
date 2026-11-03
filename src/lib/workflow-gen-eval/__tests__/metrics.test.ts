import { describe, it, expect } from 'vitest';
import { BENCHMARK_DATASET_V1 } from '../dataset';
import { applyJudge, evaluateCase, evaluateSemantics, evaluateStructure } from '../metrics';
import { buildWorkflow } from './fixtures';
import type { TinyflowData } from '@/lib/tinyflow/types';

const case01 = BENCHMARK_DATASET_V1.cases[0];

describe('结构评估', () => {
  it('合法工作流结构与参数全部通过', () => {
    const result = evaluateStructure(case01, buildWorkflow(case01));
    expect(result.schemaValid).toBe(true);
    expect(result.nodeTypeValid).toBe(true);
    expect(result.graphConnected).toBe(true);
    expect(result.parametersComplete).toBe(true);
    expect(result.structureScore).toBe(100);
  });

  it('缺少终态节点时连通性失败', () => {
    const flow = buildWorkflow(case01);
    flow.nodes = flow.nodes.filter((node) => node.type !== 'endNode');
    const result = evaluateStructure(case01, flow);
    expect(result.graphConnected).toBe(false);
    expect(result.issues.some((issue) => issue.includes('endNode'))).toBe(true);
  });

  it('孤立节点被识别', () => {
    const flow = buildWorkflow(case01);
    flow.nodes.push({
      id: 'orphan',
      type: 'codeNode',
      position: { x: 0, y: 200 },
      data: { code: 'return 1' },
    } as never);
    const result = evaluateStructure(case01, flow);
    expect(result.graphConnected).toBe(false);
    expect(result.issues.some((issue) => issue.includes('孤立节点'))).toBe(true);
  });

  it('缺少必填参数', () => {
    const flow = buildWorkflow(case01);
    const llm = flow.nodes.find((node) => node.type === 'llmNode');
    (llm as { data: Record<string, unknown> }).data.llmId = '';
    const result = evaluateStructure(case01, flow);
    expect(result.parametersComplete).toBe(false);
    expect(result.issues.some((issue) => issue.includes('llmNode.llmId'))).toBe(true);
  });

  it('生成失败时结构分为 0', () => {
    const result = evaluateStructure(case01, null);
    expect(result.structureScore).toBe(0);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe('语义评估', () => {
  it('满足节点选择与约束', () => {
    const result = evaluateSemantics(case01, buildWorkflow(case01));
    expect(result.nodeSelection).toBe(1);
    expect(result.constraintCoverage).toBe(1);
    expect(result.violated).toEqual([]);
    expect(result.semanticScore).toBe(100);
  });

  it('缺少期望节点导致选择分下降', () => {
    const flow = buildWorkflow(case01) as TinyflowData;
    flow.nodes = flow.nodes.filter((node) => node.type !== 'searchEngineNode');
    flow.edges = flow.edges.filter(
      (edge) => !edge.source.startsWith('searchEngineNode') && !edge.target.startsWith('searchEngineNode'),
    );
    const result = evaluateSemantics(case01, flow);
    expect(result.nodeSelection).toBeLessThan(1);
    expect(result.violated.some((item) => item.includes('searchEngineNode → llmNode'))).toBe(true);
  });

  it('使用禁用节点会被扣分并记录', () => {
    const flow = buildWorkflow(case01);
    flow.nodes.push({
      id: 'loop-x',
      type: 'loopNode',
      position: { x: 0, y: 0 },
      data: {},
    } as never);
    const result = evaluateSemantics(case01, flow);
    expect(result.forbiddenUsed).toContain('loopNode');
    expect(result.nodeSelection).toBeLessThan(1);
  });

  it('搜索结果未连到 LLM 时约束不满足', () => {
    const flow = buildWorkflow(case01);
    // 断开 search → llm，改接 search → end
    const search = flow.nodes.find((node) => node.type === 'searchEngineNode');
    const end = flow.nodes.find((node) => node.type === 'endNode');
    flow.edges = flow.edges.filter((edge) => edge.source !== search?.id);
    flow.edges.push({ id: 'e-x', source: search!.id, target: end!.id } as never);

    const result = evaluateSemantics(case01, flow);
    expect(result.constraintCoverage).toBeLessThan(1);
  });
});

describe('Judge 权重', () => {
  it('Judge 只能补 20%，不能覆盖结构分', () => {
    const base = evaluateCase(case01, buildWorkflow(case01));
    const judged = applyJudge(base, {
      score: 0,
      reason: '意图偏差',
      modelId: 'judge-model',
      promptVersion: 'v1',
    });

    expect(judged.deterministicScore).toBe(100);
    expect(judged.judge?.weightedScore).toBe(80);
    expect(judged.finalScore).toBe(80);
  });

  it('Schema 不合法时不采信 Judge', () => {
    const broken = evaluateCase(case01, null);
    const judged = applyJudge(broken, {
      score: 100,
      reason: '看起来不错',
      modelId: 'judge-model',
      promptVersion: 'v1',
    });

    expect(judged.finalScore).toBe(0);
    expect(judged.grade).toBe('bad');
  });
});
