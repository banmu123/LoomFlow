/**
 * Workflow Generation Benchmark - Tests
 *
 * 验证 benchmark 框架的功能
 */

import { describe, it, expect } from 'vitest';
import { ALL_CASES, SIMPLE_CASES, MEDIUM_CASES, COMPLEX_CASES, getCasesByCategory, getTestCase } from '../test-cases';
import { evaluateSchemaValidity, evaluateNodeCorrectness, calculateTotalScore, runBenchmark } from '../evaluation';
import { createMockGenerator } from '../mock-generator';
import type { TinyflowData } from '../../../lib/tinyflow/types';

describe('Benchmark Test Cases', () => {
  it('should have correct number of cases', () => {
    expect(ALL_CASES.length).toBe(9);
    expect(SIMPLE_CASES.length).toBe(3);
    expect(MEDIUM_CASES.length).toBe(3);
    expect(COMPLEX_CASES.length).toBe(3);
  });

  it('should get cases by category', () => {
    expect(getCasesByCategory('simple')).toEqual(SIMPLE_CASES);
    expect(getCasesByCategory('medium')).toEqual(MEDIUM_CASES);
    expect(getCasesByCategory('complex')).toEqual(COMPLEX_CASES);
  });

  it('should get specific test case', () => {
    const testCase = getTestCase('simple-llm');
    expect(testCase).toBeDefined();
    expect(testCase?.id).toBe('simple-llm');
    expect(testCase?.input).toContain('AI');
  });

  it('should return undefined for non-existent case', () => {
    expect(getTestCase('non-existent')).toBeUndefined();
  });

  it('should have valid weights for all cases', () => {
    for (const testCase of ALL_CASES) {
      const totalWeight = testCase.evaluationWeights.schemaValidity +
        testCase.evaluationWeights.nodeCorrectness +
        testCase.evaluationWeights.executionSuccess;
      expect(totalWeight).toBeCloseTo(1, 2);
    }
  });
});

describe('Evaluation Functions', () => {
  describe('evaluateSchemaValidity', () => {
    it('should return 100 for valid workflow', () => {
      const validWorkflow: TinyflowData = {
        nodes: [
          { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: { title: '开始' } },
          { id: 'end', type: 'endNode', position: { x: 200, y: 0 }, data: { title: '结束' } },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'end' },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
      };
      expect(evaluateSchemaValidity(validWorkflow)).toBe(100);
    });

    it('should return 0 for null workflow', () => {
      expect(evaluateSchemaValidity(null)).toBe(0);
    });

    it('should return 0 for workflow missing start node', () => {
      const invalidWorkflow: TinyflowData = {
        nodes: [
          { id: 'end', type: 'endNode', position: { x: 200, y: 0 }, data: { title: '结束' } },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      };
      expect(evaluateSchemaValidity(invalidWorkflow)).toBe(0);
    });
  });

  describe('evaluateNodeCorrectness', () => {
    it('should give high score for matching workflow', () => {
      const workflow: TinyflowData = {
        nodes: [
          { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: { title: '开始' } },
          { id: 'llm', type: 'llmNode', position: { x: 200, y: 0 }, data: { title: 'LLM' } },
          { id: 'end', type: 'endNode', position: { x: 400, y: 0 }, data: { title: '结束' } },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'llm' },
          { id: 'e2', source: 'llm', target: 'end' },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const expected = {
        nodeTypes: ['llmNode'],
        minNodes: 3,
        maxNodes: 4,
        requiredConnections: 2,
        shouldHaveLLM: true,
      };

      const score = evaluateNodeCorrectness(workflow, expected);
      expect(score).toBeGreaterThan(80);
    });

    it('should give low score for mismatching workflow', () => {
      const workflow: TinyflowData = {
        nodes: [
          { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: { title: '开始' } },
          { id: 'http', type: 'httpNode', position: { x: 200, y: 0 }, data: { title: 'HTTP' } },
          { id: 'end', type: 'endNode', position: { x: 400, y: 0 }, data: { title: '结束' } },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'http' },
          { id: 'e2', source: 'http', target: 'end' },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const expected = {
        nodeTypes: ['llmNode'],
        minNodes: 3,
        maxNodes: 4,
        requiredConnections: 2,
        shouldHaveLLM: true,
      };

      const score = evaluateNodeCorrectness(workflow, expected);
      expect(score).toBeLessThan(60);
    });
  });

  describe('calculateTotalScore', () => {
    it('should calculate weighted score correctly', () => {
      const scores = {
        schemaValidity: 100,
        nodeCorrectness: 80,
        executionSuccess: 60,
      };
      const weights = {
        schemaValidity: 0.4,
        nodeCorrectness: 0.3,
        executionSuccess: 0.3,
      };

      const total = calculateTotalScore(scores, weights);
      expect(total).toBe(82); // 100*0.4 + 80*0.3 + 60*0.3 = 40 + 24 + 18 = 82
    });
  });
});

describe('Mock Generator', () => {
  it('should generate workflow for AI input', async () => {
    const generator = createMockGenerator();
    const result = await generator('创建一个AI对话流程');

    expect(result.workflow).not.toBeNull();
    expect(result.workflow?.nodes.some(n => n.type === 'llmNode')).toBe(true);
    expect(result.tokens).toBeGreaterThan(0);
    expect(result.cost).toBeGreaterThan(0);
  });

  it('should generate workflow for search input', async () => {
    const generator = createMockGenerator();
    const result = await generator('搜索资料并生成研究报告');

    expect(result.workflow).not.toBeNull();
    expect(result.workflow?.nodes.some(n => n.type === 'searchEngineNode')).toBe(true);
    expect(result.workflow?.nodes.some(n => n.type === 'llmNode')).toBe(true);
  });

  it('should generate workflow with condition for customer support', async () => {
    const generator = createMockGenerator();
    const result = await generator('创建一个客服问题分类和回答系统');

    expect(result.workflow).not.toBeNull();
    expect(result.workflow?.nodes.some(n => n.type === 'conditionNode')).toBe(true);
  });
});

describe('Benchmark Runner', () => {
  it('should run benchmark with mock generator', async () => {
    const generator = createMockGenerator();
    const result = await runBenchmark(generator, { category: 'simple' });

    expect(result.summary.totalCases).toBe(3);
    expect(result.results.length).toBe(3);
    expect(result.summary.generationSuccessRate).toBe(100);
  });

  it('should calculate summary correctly', async () => {
    const generator = createMockGenerator();
    const result = await runBenchmark(generator);

    expect(result.summary.totalCases).toBe(9);
    expect(result.summary.passed + result.summary.failed).toBe(9);
    expect(result.summary.averageScore).toBeGreaterThanOrEqual(0);
    expect(result.summary.averageScore).toBeLessThanOrEqual(100);
  });
});
