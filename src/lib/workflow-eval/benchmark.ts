/**
 * Benchmark（Part 九）
 *
 * 对比两个版本：Latency / Cost / Success Rate / Test Score。
 * 通过多次采样运行同一组输入，聚合指标后比较；输出 AI 可读结论。
 *
 * 支持注入采样器（测试友好）：默认用 FlowEngine 真实执行。
 */

import { FlowEngine } from '../tinyflow/engine/FlowEngine';
import type { TinyflowData } from '../tinyflow/types';
import type { RunTrace } from '../tinyflow/runtime/trace';
import { aggregateWorkflowMetrics, type RunRecordLike } from './metrics';

export interface BenchmarkSample {
  status: 'completed' | 'failed' | 'timeout' | 'cancelled';
  durationMs: number;
  trace: RunTrace;
}

export interface VersionBenchmark {
  version: number;
  samples: BenchmarkSample[];
  /** 采样聚合 */
  latencyMs: number;
  cost: number;
  successRate: number;
  testScore: number;
  totalTokens: number;
}

export interface BenchmarkResult {
  v1: VersionBenchmark;
  v2: VersionBenchmark;
  winner: 'v1' | 'v2' | 'tie';
  conclusion: string;
  table: Array<{ metric: string; v1: string; v2: string; better: 'v1' | 'v2' | '-' }>;
}

export type BenchmarkSampler = (
  flowData: TinyflowData,
  inputs: Record<string, unknown>,
  label: string,
) => Promise<BenchmarkSample>;

/** 默认采样器：真实 FlowEngine 执行 */
export const realSampler: BenchmarkSampler = async (flowData, inputs) => {
  const start = Date.now();
  const engine = new FlowEngine(flowData, {
    flowData,
    inputs,
    timeoutMs: 20_000,
    defaultNodeTimeoutMs: 15_000,
    maxConcurrency: 1,
  });
  const RUN_STATE_MAP = {
  completed: 'completed',
  failed: 'failed',
  timeout: 'timeout',
  cancelled: 'cancelled',
} as const;

let status: BenchmarkSample['status'] = 'completed';
  try {
    await engine.run();
    const st = engine.getState();
    status = RUN_STATE_MAP[st as keyof typeof RUN_STATE_MAP] ?? 'completed';
  } catch {
    const st = engine.getState();
    status = RUN_STATE_MAP[st as keyof typeof RUN_STATE_MAP] ?? 'failed';
  }
  return { status, durationMs: Date.now() - start, trace: engine.getTrace() };
};

export function aggregateSamples(samples: BenchmarkSample[], testScore = 100): Omit<VersionBenchmark, 'version'> {
  const runs: RunRecordLike[] = samples.map((s, i) => ({
    id: `s${i}`,
    status: s.status,
    duration_ms: s.durationMs,
    retry_count: s.trace.retryCount,
    token_usage: s.trace.tokenUsage,
    cost: s.trace.cost,
  }));
  const m = aggregateWorkflowMetrics(runs);
  return {
    samples,
    latencyMs: m.averageLatencyMs,
    cost: m.estimatedCostPerRun,
    successRate: m.successRate,
    testScore,
    totalTokens: m.averageTokenUsage,
  };
}

const fmt = (n: number): string => (n === 0 ? '0' : n < 0.001 ? n.toFixed(6) : n.toFixed(3));

/** 执行并对比两个版本 */
export async function benchmarkVersions(
  options: {
    v1: { version: number; data: TinyflowData };
    v2: { version: number; data: TinyflowData };
    inputs: Record<string, unknown>;
    samples?: number;
    /** 每个版本的测试得分（0-100，传入测试运行结果） */
    testScores?: { v1: number; v2: number };
    sampler?: BenchmarkSampler;
  },
): Promise<BenchmarkResult> {
  const s = options.sampler ?? realSampler;
  const count = Math.max(1, options.samples ?? 3);

  const runAll = async (data: TinyflowData, label: string): Promise<BenchmarkSample[]> => {
    const out: BenchmarkSample[] = [];
    for (let i = 0; i < count; i++) {
      out.push(await s(data, options.inputs, label));
    }
    return out;
  };

  const [s1, s2] = await Promise.all([
    runAll(options.v1.data, `v${options.v1.version}`),
    runAll(options.v2.data, `v${options.v2.version}`),
  ]);

  const agg1 = aggregateSamples(s1, options.testScores?.v1);
  const agg2 = aggregateSamples(s2, options.testScores?.v2);
  const b1: VersionBenchmark = { version: options.v1.version, ...agg1 };
  const b2: VersionBenchmark = { version: options.v2.version, ...agg2 };

  const table: BenchmarkResult['table'] = [
    { metric: 'Latency', v1: `${b1.latencyMs}ms`, v2: `${b2.latencyMs}ms`, better: b1.latencyMs < b2.latencyMs ? 'v1' : b2.latencyMs < b1.latencyMs ? 'v2' : '-' },
    { metric: 'Cost', v1: `$${fmt(b1.cost)}`, v2: `$${fmt(b2.cost)}`, better: b1.cost < b2.cost ? 'v1' : b2.cost < b1.cost ? 'v2' : '-' },
    { metric: 'Success Rate', v1: `${b1.successRate}%`, v2: `${b2.successRate}%`, better: b1.successRate > b2.successRate ? 'v1' : b2.successRate > b1.successRate ? 'v2' : '-' },
    { metric: 'Test Score', v1: `${b1.testScore}`, v2: `${b2.testScore}`, better: b1.testScore > b2.testScore ? 'v1' : b2.testScore > b1.testScore ? 'v2' : '-' },
  ];

  // 综合判定（简单加权：延迟 40% + 成本 20% + 成功率 20% + 测试 20%）
  const score = (b: VersionBenchmark): number =>
    (100 - Math.min(100, b.latencyMs / 50)) * 0.4 +
    (100 - Math.min(100, b.cost * 2000)) * 0.2 +
    b.successRate * 0.2 +
    b.testScore * 0.2;

  const sScore = score(b1);
  const eScore = score(b2);
  const winner: BenchmarkResult['winner'] = sScore > eScore + 1 ? 'v1' : eScore > sScore + 1 ? 'v2' : 'tie';

  const conclusion =
    winner === 'tie'
      ? '两个版本总体接近，无显著差异。'
      : winner === 'v1'
        ? `建议保留 v${b1.version}：更低延迟/成本或更高成功率/测试得分。`
        : `v${b2.version} 更优：建议将工作流优化到此版本。`;

  return { v1: b1, v2: b2, winner, conclusion, table };
}

/** 把 benchmark 渲染为 markdown 表格（UI / AI 可读） */
export function benchmarkToMarkdown(r: BenchmarkResult): string {
  const lines = [
    `## Benchmark v${r.v1.version} vs v${r.v2.version}`,
    '',
    '| 指标 | v' + r.v1.version + ' | v' + r.v2.version + ' | 更优 |',
    '| --- | --- | --- | --- |',
    ...r.table.map((row) => `| ${row.metric} | ${row.v1} | ${row.v2} | ${row.better} |`),
    '',
    r.conclusion,
  ];
  return lines.join('\n');
}