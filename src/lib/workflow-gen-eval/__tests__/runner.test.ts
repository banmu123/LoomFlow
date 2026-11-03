import { describe, it, expect } from 'vitest';
import { BENCHMARK_DATASET_V1 } from '../dataset';
import { compareGenerationReports, runGenerationSuite } from '../runner';
import type { GeneratedWorkflow } from '../types';
import { buildWorkflow } from './fixtures';

function goodGenerator(): (caseDef: Parameters<typeof buildWorkflow>[0]) => Promise<GeneratedWorkflow> {
  return async (caseDef) => ({
    workflow: buildWorkflow(caseDef),
    latencyMs: 120,
    inputTokens: 100,
    outputTokens: 50,
    cost: 0.0001,
  });
}

const brokenGenerator = async (): Promise<GeneratedWorkflow> => ({
  workflow: null,
  error: '模型没有返回可解析的工作流',
  latencyMs: 60,
  cost: null,
});

describe('评测 Runner', () => {
  it('高质量生成 → allow，并记录版本信息', async () => {
    const report = await runGenerationSuite({
      dataset: BENCHMARK_DATASET_V1,
      generator: goodGenerator(),
      promptVersion: 'prompt-v3',
      modelId: 'deepseek-v4-flash',
      temperature: 0.2,
      now: () => new Date('2026-11-03T12:00:00Z'),
    });

    expect(report.aggregate.schemaValidity).toBe(1);
    expect(report.aggregate.averageScore).toBeGreaterThanOrEqual(90);
    expect(report.decision).toBe('allow');
    expect(report.promptVersion).toBe('prompt-v3');
    expect(report.modelId).toBe('deepseek-v4-flash');
    expect(report.generatedAt).toBe('2026-11-03T12:00:00.000Z');
    expect(report.aggregate.inputTokens).toBe(1000);
    expect(report.aggregate.estimatedCost).toBeCloseTo(0.001);
  });

  it('全部生成失败 → block', async () => {
    const report = await runGenerationSuite({
      dataset: BENCHMARK_DATASET_V1,
      generator: brokenGenerator,
      promptVersion: 'prompt-v3',
    });

    expect(report.aggregate.schemaValidity).toBe(0);
    expect(report.decision).toBe('block');
    expect(report.cases[0].structural.issues.join(' ')).toContain('可解析');
  });

  it('执行数据参与成功率与任务完成率', async () => {
    let index = 0;
    const report = await runGenerationSuite({
      dataset: BENCHMARK_DATASET_V1,
      generator: goodGenerator(),
      promptVersion: 'prompt-v3',
      executor: async () => {
        index += 1;
        return {
          success: index <= 8,
          outputMatched: index <= 7,
          latencyMs: 500,
        };
      },
    });

    expect(report.aggregate.executionSuccessRate).toBeCloseTo(0.8);
    expect(report.aggregate.taskCompletionRate).toBeCloseTo(0.7);
    expect(report.aggregate.executionLatencyMs).toBe(500);
  });

  it('任务完成率偏低给出 warning 而不是直接 block', async () => {
    const report = await runGenerationSuite({
      dataset: BENCHMARK_DATASET_V1,
      generator: goodGenerator(),
      promptVersion: 'prompt-v3',
      executor: async () => ({ success: true, outputMatched: false, latencyMs: 100 }),
    });

    expect(report.aggregate.taskCompletionRate).toBe(0);
    expect(report.decision).toBe('warning');
  });

  it('记录修复率', async () => {
    const generator = async (caseDef: Parameters<typeof buildWorkflow>[0]): Promise<GeneratedWorkflow> => ({
      workflow: buildWorkflow(caseDef),
      latencyMs: 100,
      repairAttempted: caseDef.id === 'case-01',
    });

    const report = await runGenerationSuite({
      dataset: BENCHMARK_DATASET_V1,
      generator,
      promptVersion: 'prompt-v3',
    });

    expect(report.aggregate.repairRate).toBeCloseTo(0.1);
  });

  it('Judge 只在 Schema 合法时生效，并写入版本信息', async () => {
    const report = await runGenerationSuite({
      dataset: BENCHMARK_DATASET_V1,
      generator: goodGenerator(),
      promptVersion: 'prompt-v3',
      judge: {
        modelId: 'judge-model',
        promptVersion: 'judge-v1',
        fn: async () => ({ score: 50, reason: '部分意图未覆盖' }),
      },
    });

    const first = report.cases[0];
    expect(first.judge?.modelId).toBe('judge-model');
    expect(first.judge?.promptVersion).toBe('judge-v1');
    expect(first.finalScore).toBe(90);
    expect(report.aggregate.averageScore).toBe(90);
  });
});

describe('A/B 对比', () => {
  it('候选版本更好时胜出，并保留指标差异', async () => {
    const baseline = await runGenerationSuite({
      dataset: BENCHMARK_DATASET_V1,
      generator: brokenGenerator,
      promptVersion: 'prompt-v2',
    });
    const candidate = await runGenerationSuite({
      dataset: BENCHMARK_DATASET_V1,
      generator: goodGenerator(),
      promptVersion: 'prompt-v3',
    });

    const comparison = compareGenerationReports(baseline, candidate);

    expect(comparison.winner).toBe('candidate');
    expect(comparison.conclusion).toContain('候选');
    expect(comparison.baseline.promptVersion).toBe('prompt-v2');
    expect(comparison.candidate.promptVersion).toBe('prompt-v3');

    const schema = comparison.metrics.find((item) => item.metric === 'Schema Validity');
    expect(schema).toMatchObject({ a: 0, b: 1, better: 'b' });
  });

  it('未采集的执行指标不参与胜负判断', async () => {
    const a = await runGenerationSuite({
      dataset: BENCHMARK_DATASET_V1,
      generator: goodGenerator(),
      promptVersion: 'p1',
    });
    const b = await runGenerationSuite({
      dataset: BENCHMARK_DATASET_V1,
      generator: goodGenerator(),
      promptVersion: 'p2',
    });

    const comparison = compareGenerationReports(a, b);
    const execution = comparison.metrics.find((item) => item.metric === 'Execution Success');
    expect(execution?.a).toBeNull();
    expect(execution?.delta).toBeNull();
    expect(comparison.winner).toBe('tie');
  });
});
