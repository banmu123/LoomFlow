import { describe, it, expect } from 'vitest';
import {
  getModelPrice,
  estimateCallCost,
  estimateCostFromTotal,
  DEFAULT_PRICE,
} from '../pricing';
import { evaluateRun, evalToText } from '../eval-model';
import {
  aggregateWorkflowMetrics,
  aggregateNodeMetrics,
  filterRunsByRange,
  rangeToMs,
  _p95,
  _avg,
  type RunRecordLike,
} from '../metrics';
import { analyzeWorkflow } from '../static-analysis';
import { detectBottlenecks } from '../bottleneck';
import { aggregateSamples, benchmarkVersions, benchmarkToMarkdown } from '../benchmark';
import type { TinyflowData } from '../../tinyflow/types';
import type { RunTrace } from '../../tinyflow/runtime/trace';

function makeTrace(overrides: Partial<RunTrace> = {}): RunTrace {
  return {
    flowId: 'f1',
    workflowId: null,
    version: 1,
    status: 'completed',
    startedAt: 0,
    finishedAt: 1000,
    durationMs: 1000,
    retryCount: 0,
    tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    cost: 0.002,
    nodes: [
      { nodeId: 'search', type: 'searchEngineNode', title: '搜索', status: 'success', startedAt: 0, finishedAt: 300, durationMs: 300, attempts: [], retryCount: 0 },
      { nodeId: 'llm', type: 'llmNode', title: '生成', status: 'success', startedAt: 300, finishedAt: 1000, durationMs: 700, attempts: [], retryCount: 0 },
    ],
    ...overrides,
  };
}

function run(status = 'completed', overrides: Partial<RunRecordLike> = {}): RunRecordLike {
  return {
    id: 'r1',
    status,
    created_at: new Date('2026-08-20T00:00:00Z').toISOString(),
    duration_ms: 1000,
    retry_count: 0,
    token_usage: { totalTokens: 150 },
    cost: 0.002,
    trace: makeTrace(),
    ...overrides,
  };
}

describe('定价抽象 pricing', () => {
  it('已知模型返回价格', () => {
    expect(getModelPrice('deepseek-v4-flash').outputPer1K).toBe(0.003);
  });
  it('未知模型回退默认', () => {
    expect(getModelPrice('unknown-model')).toEqual(DEFAULT_PRICE);
  });
  it('前缀匹配（如 gpt-4o-2024-08）', () => {
    expect(getModelPrice('gpt-4o-2024-08-06').inputPer1K).toBe(0.0025);
  });
  it('estimateCallCost 计算正确', () => {
    const p = { inputPer1K: 0.002, outputPer1K: 0.006 };
    // 1000 prompt * 0.002/1k = 0.002 ; 1000 completion * 0.006/1k = 0.006 → total 0.008
    expect(estimateCallCost({ promptTokens: 1000, completionTokens: 1000 }, p)).toBeCloseTo(0.008);
  });
  it('estimateCostFromTotal 单调递增', () => {
    expect(estimateCostFromTotal(2000, 'gpt-4o')).toBeGreaterThan(estimateCostFromTotal(1000, 'gpt-4o'));
  });
});

describe('Evaluation Model', () => {
  it('成功 run 各维度良好', () => {
    const ev = evaluateRun(makeTrace(), 'completed');
    const dims = Object.fromEntries(ev.dimensions.map((d) => [d.name, d.level]));
    expect(dims.correctness).toBe('good');
    expect(dims.latency).toBe('good');
    expect(dims.timeout_rate).toBe('good');
    expect(ev.summary.latencyMs).toBe(1000);
  });

  it('失败 run 标出 bad', () => {
    const trace = makeTrace({
      status: 'failed',
      retryCount: 2,
      nodes: [
        { nodeId: 'llm', type: 'llmNode', title: '生成', status: 'failed', startedAt: 0, finishedAt: 700, durationMs: 700, attempts: [], retryCount: 2 },
      ],
    });
    const ev = evaluateRun(trace, 'failed');
    const dims = Object.fromEntries(ev.dimensions.map((d) => [d.name, d.level]));
    expect(dims.correctness).toBe('bad');
    expect(dims.reliability).toBe('bad');
    expect(dims.retry_rate).toBe('warn');
    expect(ev.summary.retryCount).toBe(2);
  });

  it('超时 run 标出 timeout bad', () => {
    const ev = evaluateRun(makeTrace(), 'timeout');
    const dims = Object.fromEntries(ev.dimensions.map((d) => [d.name, d.level]));
    expect(dims.timeout_rate).toBe('good'); // 无超时节点
    expect(dims.correctness).toBe('bad');
    expect(ev.status).toBe('timeout');
  });

  it('evalToText 输出可读', () => {
    const text = evalToText(evaluateRun(makeTrace(), 'completed'));
    expect(text).toContain('correctness');
    expect(text).toContain('latency');
  });
});

describe('Workflow Metrics', () => {
  it('P95 计算', () => {
    expect(_p95([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])).toBe(20);
  });
  it('filterRunsByRange 24h 过滤', () => {
    const recent = run('completed', { created_at: new Date().toISOString() });
    const old = run('completed', { created_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString() });
    const out = filterRunsByRange([recent, old], '24h');
    expect(out).toHaveLength(1);
    expect(rangeToMs('7d')).toBeGreaterThan(rangeToMs('24h'));
  });
  it('聚合成功率/延迟/成本', () => {
    const m = aggregateWorkflowMetrics([
      run('completed', { duration_ms: 500, cost: 0.01 }),
      run('completed', { duration_ms: 1500, cost: 0.02 }),
      run('failed', { duration_ms: 800, cost: 0.005 }),
    ]);
    expect(m.totalRuns).toBe(3);
    expect(m.successRate).toBe(66.7);
    expect(m.averageLatencyMs).toBe(933);
    expect(m.failureRate).toBe(33.3);
  });
  it('节点聚合：最慢/最贵/最易失败', () => {
    const runs = [
      run('completed', { trace: makeTrace({ nodes: [
        { nodeId: 'slow', type: 'llmNode', title: '慢', status: 'success', startedAt: 0, finishedAt: 4000, durationMs: 4000, attempts: [], retryCount: 0 },
      ] }) }),
      run('failed', { trace: makeTrace({ nodes: [
        { nodeId: 'slow', type: 'llmNode', title: '慢', status: 'failed', startedAt: 0, finishedAt: 4000, durationMs: 4000, attempts: [], retryCount: 3 },
      ] }) }),
    ];
    const agg = aggregateNodeMetrics(runs);
    expect(agg.slowest?.nodeId).toBe('slow');
    expect(agg.nodes[0].executionCount).toBe(2);
    expect(agg.nodes[0].retryCount).toBe(3);
    expect(agg.nodes[0].failureRate).toBe(50);
  });
});

describe('静态分析', () => {
  function flow(nodes: unknown[], edges: unknown[]): TinyflowData {
    return { nodes: nodes as TinyflowData['nodes'], edges: edges as TinyflowData['edges'], viewport: { x: 0, y: 0, zoom: 1 } };
  }
  it('检测不可达/悬空节点与并行对', () => {
    const f = flow(
      [
        { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: {} },
        { id: 'a', type: 'codeNode', position: { x: 0, y: 0 }, data: { title: 'A' } },
        { id: 'b', type: 'codeNode', position: { x: 0, y: 0 }, data: { title: 'B' } },
        { id: 'orphan', type: 'codeNode', position: { x: 0, y: 0 }, data: { title: '孤岛' } },
        { id: 'end', type: 'endNode', position: { x: 0, y: 0 }, data: {} },
      ],
      [
        { id: 'e1', source: 'start', target: 'a' },
        { id: 'e2', source: 'start', target: 'b' },
        { id: 'e3', source: 'a', target: 'end' },
        { id: 'e4', source: 'b', target: 'end' },
      ],
    );
    const r = analyzeWorkflow(f);
    expect(r.findings.some((x) => x.code === 'unreachable_node' && x.nodeId === 'orphan')).toBe(true);
    // a 与 b 无依赖 → 可并行
    expect(r.parallelizable.some(([x, y]) => (x === 'a' && y === 'b') || (x === 'b' && y === 'a'))).toBe(true);
  });
  it('检测 LLM 串联、缺重试、无限循环', () => {
    const f = flow(
      [
        { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: {} },
        { id: 'l1', type: 'llmNode', position: { x: 0, y: 0 }, data: { title: 'L1', userPrompt: 'x' } },
        { id: 'l2', type: 'llmNode', position: { x: 0, y: 0 }, data: { title: 'L2', userPrompt: 'y' } },
        { id: 'loop', type: 'loopNode', position: { x: 0, y: 0 }, data: { title: '循环', loopEnable: true, maxLoopCount: 0 } },
        { id: 'end', type: 'endNode', position: { x: 0, y: 0 }, data: {} },
      ],
      [
        { id: 'e1', source: 'start', target: 'l1' },
        { id: 'e2', source: 'l1', target: 'l2' },
        { id: 'e3', source: 'l2', target: 'end' },
      ],
    );
    const r = analyzeWorkflow(f);
    expect(r.findings.some((x) => x.code === 'unnecessary_llm_call')).toBe(true);
    expect(r.findings.some((x) => x.code === 'missing_error_handling' && x.nodeId === 'l1')).toBe(true);
    expect(r.findings.some((x) => x.code === 'potential_infinite_loop')).toBe(true);
  });
});

describe('瓶颈检测', () => {
  it('识别延迟/成本瓶颈', () => {
    const workflow = {
      totalRuns: 10,
      successRate: 90,
      averageLatencyMs: 5000,
      p95LatencyMs: 7000,
      averageTokenUsage: 1000,
      estimatedCostPerRun: 0.02,
      totalEstimatedCost: 0.2,
      failureRate: 10,
      retryRate: 1,
      timeoutRate: 0,
      runs: [],
    };
    const nodes = [
      { nodeId: 'a', type: 'codeNode', title: 'A', executionCount: 10, averageDurationMs: 200, p95DurationMs: 300, failureRate: 0, retryCount: 0, averageTokenUsage: 0, estimatedCost: 0 },
      { nodeId: 'b', type: 'llmNode', title: 'LLM B', executionCount: 10, averageDurationMs: 4000, p95DurationMs: 5000, failureRate: 20, retryCount: 1, averageTokenUsage: 2000, estimatedCost: 0.012 },
    ];
    const r = detectBottlenecks(workflow, nodes);
    expect(r.bottlenecks.some((b) => b.kind === 'latency' && b.nodeId === 'b')).toBe(true);
    expect(r.bottlenecks.some((b) => b.kind === 'cost' && b.nodeId === 'b')).toBe(true);
    expect(r.bottlenecks.some((b) => b.kind === 'failure')).toBe(true);
    expect(r.summary).toContain('2');
  });
});

describe('Benchmark', () => {
  function codeFlow(v: string): TinyflowData {
    return {
      nodes: [
        { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: { title: 's', parameters: [] } },
        { id: 'code', type: 'codeNode', position: { x: 0, y: 0 }, data: { title: v, code: `return "v${v}";` } },
        { id: 'end', type: 'endNode', position: { x: 0, y: 0 }, data: { title: 'e', parameters: [{ id: 'o', name: 'out', refType: 'ref', ref: 'code.output' }] } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'code' },
        { id: 'e2', source: 'code', target: 'end' },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    } as TinyflowData;
  }

  it('aggregateSamples 聚合指标', () => {
    const samples = [
      { status: 'completed' as const, durationMs: 500, trace: makeTrace() },
      { status: 'completed' as const, durationMs: 700, trace: makeTrace() },
    ];
    const a = aggregateSamples(samples);
    expect(a.latencyMs).toBe(600);
    expect(a.successRate).toBe(100);
  });

  it('benchmarkVersions：用注入 sampler 比较两版', async () => {
    const makeSample = () => ({ status: 'completed' as const, durationMs: 600, trace: makeTrace() });
    const sampler = async (): Promise<ReturnType<typeof makeSample>> => makeSample();
    const r = await benchmarkVersions({
      v1: { version: 10, data: codeFlow('10') },
      v2: { version: 11, data: codeFlow('11') },
      inputs: {},
      samples: 2,
      sampler,
    });
    expect(r.v1.version).toBe(10);
    expect(r.winner).toBe('tie');
    expect(benchmarkToMarkdown(r)).toContain('v10');
    expect(benchmarkToMarkdown(r)).toContain('v11');
  });
});