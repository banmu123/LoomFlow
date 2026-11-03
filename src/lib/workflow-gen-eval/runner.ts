import type { TinyflowData } from '@/lib/tinyflow/types';
import { DEFAULT_GENERATION_THRESHOLDS } from './types';
import type {
  AbComparison,
  AbMetricComparison,
  BenchmarkCase,
  BenchmarkDataset,
  CaseEvaluation,
  CaseExecutionResult,
  GenerationAggregate,
  GenerationReport,
  GenerationThresholds,
  WorkflowGenerator,
} from './types';
import { applyJudge, evaluateCase } from './metrics';

export const JUDGE_PROMPT_VERSION = 'wf-gen-judge-v1';

/** Judge Prompt 版本化：内容进入报告，便于复现 */
export function buildJudgePrompt(caseDef: BenchmarkCase, workflow: TinyflowData): string {
  return [
    '你是工作流生成质量评审。只评估「生成结果是否覆盖用户意图」，不要评估代码风格。',
    `用户输入：${caseDef.input}`,
    `期望意图：${caseDef.expectedIntent}`,
    `期望节点：${caseDef.expectedNodeTypes.join(', ')}`,
    workflowSummary(workflow),
    '输出 JSON：{"score":0-100,"reason":"不超过 80 字"}',
  ].join('\n');
}

function workflowSummary(workflow: TinyflowData): string {
  const nodes = (workflow.nodes ?? []).map((node) => `${node.type}#${node.id}`).join(', ');
  const edges = (workflow.edges ?? [])
    .map((edge) => `${edge.source}->${edge.target}`)
    .join(', ');
  return `生成节点：[${nodes}]\n连接：[${edges}]`;
}

export interface JudgeConfig {
  fn: (
    caseDef: BenchmarkCase,
    workflow: TinyflowData,
    prompt: string,
  ) => Promise<{ score: number; reason: string }>;
  modelId: string;
  promptVersion?: string;
}

export interface ExecutionSample {
  success: boolean;
  outputMatched?: boolean | null;
  latencyMs: number;
  error?: string;
}

export interface RunSuiteOptions {
  dataset: BenchmarkDataset;
  generator: WorkflowGenerator;
  promptVersion: string;
  modelId?: string | null;
  temperature?: number | null;
  judge?: JudgeConfig;
  executor?: (workflow: TinyflowData, caseDef: BenchmarkCase) => Promise<ExecutionSample>;
  thresholds?: Partial<GenerationThresholds>;
  now?: () => Date;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function aggregate(cases: CaseEvaluation[], extras: {
  repairCount: number;
  generationLatency: number[];
  executionLatency: number[];
  inputTokens: number;
  outputTokens: number;
  costs: number[];
}): GenerationAggregate {
  const executionAttempts = cases.filter((item) => item.execution.attempted);
  const outputJudged = executionAttempts.filter((item) => item.execution.outputMatched !== null);

  return {
    cases: cases.length,
    schemaValidity: round3(average(cases.map((item) => (item.structural.schemaValid ? 1 : 0)))),
    nodeTypeValidity: round3(average(cases.map((item) => (item.structural.nodeTypeValid ? 1 : 0)))),
    graphConnectivity: round3(average(cases.map((item) => (item.structural.graphConnected ? 1 : 0)))),
    parameterCompleteness: round3(average(cases.map((item) => (item.structural.parametersComplete ? 1 : 0)))),
    nodeSelectionAccuracy: round3(average(cases.map((item) => item.semantic.nodeSelection))),
    intentCoverage: round3(average(cases.map((item) => item.semantic.intentCoverage))),
    constraintCoverage: round3(average(cases.map((item) => item.semantic.constraintCoverage))),
    structureQuality: round3(average(cases.map((item) => item.structural.structureScore / 100))),
    executionSuccessRate:
      executionAttempts.length === 0
        ? null
        : round3(average(executionAttempts.map((item) => (item.execution.success ? 1 : 0)))),
    taskCompletionRate:
      outputJudged.length === 0
        ? null
        : round3(average(outputJudged.map((item) => (item.execution.outputMatched ? 1 : 0)))),
    repairRate: round3(extras.repairCount / Math.max(cases.length, 1)),
    generationLatencyMs: Math.round(average(extras.generationLatency)),
    executionLatencyMs:
      extras.executionLatency.length === 0 ? null : Math.round(average(extras.executionLatency)),
    inputTokens: extras.inputTokens,
    outputTokens: extras.outputTokens,
    estimatedCost: extras.costs.length === 0 ? null : costsSum(extras.costs),
    averageScore: Math.round(average(cases.map((item) => item.finalScore))),
  };
}

function costsSum(costs: number[]): number {
  return Math.round(costs.reduce((sum, value) => sum + value, 0) * 1_000_000) / 1_000_000;
}

export function decideGeneration(
  aggregate: GenerationAggregate,
  thresholds: GenerationThresholds,
): GenerationReport['decision'] {
  if (aggregate.schemaValidity < thresholds.minSchemaValidity) return 'block';
  if (aggregate.averageScore < thresholds.blockScore) return 'block';
  if (aggregate.averageScore < thresholds.warnScore) return 'warning';
  if (aggregate.taskCompletionRate !== null && aggregate.taskCompletionRate < thresholds.minTaskCompletion) {
    return 'warning';
  }
  return 'allow';
}

/**
 * 运行一次完整评测：生成 → 结构/语义评估 → 可选执行 → 可选 Judge。
 *
 * 重要：结构不合法时不调用 Judge；Judge 权重上限 20%。
 */
export async function runGenerationSuite(options: RunSuiteOptions): Promise<GenerationReport> {
  const thresholds: GenerationThresholds = {
    ...DEFAULT_GENERATION_THRESHOLDS,
    ...(options.thresholds ?? {}),
  };

  const cases: CaseEvaluation[] = [];
  const generationLatency: number[] = [];
  const executionLatency: number[] = [];
  const costs: number[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let repairCount = 0;

  for (const caseDef of options.dataset.cases) {
    const generated = await options.generator(caseDef);
    generationLatency.push(generated.latencyMs);
    inputTokens += generated.inputTokens ?? 0;
    outputTokens += generated.outputTokens ?? 0;
    if (typeof generated.cost === 'number') costs.push(generated.cost);
    if (generated.repairAttempted) repairCount += 1;

    let execution: CaseExecutionResult = { attempted: false, success: false, outputMatched: null };
    if (options.executor && generated.workflow) {
      const sample = await options.executor(generated.workflow, caseDef);
      executionLatency.push(sample.latencyMs);
      execution = {
        attempted: true,
        success: sample.success,
        outputMatched: sample.outputMatched ?? null,
        error: sample.error,
      };
    }

    let evaluated = evaluateCase(caseDef, generated.workflow, execution);
    if (generated.error && !evaluated.structural.issues.includes(generated.error)) {
      evaluated = {
        ...evaluated,
        structural: { ...evaluated.structural, issues: [...evaluated.structural.issues, generated.error] },
      };
    }

    if (options.judge && generated.workflow && evaluated.structural.schemaValid) {
      const prompt = buildJudgePrompt(caseDef, generated.workflow);
      const verdict = await options.judge.fn(caseDef, generated.workflow, prompt);
      evaluated = applyJudge(evaluated, {
        score: verdict.score,
        reason: verdict.reason,
        modelId: options.judge.modelId,
        promptVersion: options.judge.promptVersion ?? JUDGE_PROMPT_VERSION,
      });
    }

    cases.push(evaluated);
  }

  const aggregateResult = aggregate(cases, {
    repairCount,
    generationLatency,
    executionLatency,
    inputTokens,
    outputTokens,
    costs,
  });

  return {
    suiteVersion: options.dataset.version,
    promptVersion: options.promptVersion,
    modelId: options.modelId ?? null,
    temperature: options.temperature ?? null,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    cases,
    aggregate: aggregateResult,
    thresholds,
    decision: decideGeneration(aggregateResult, thresholds),
  };
}

const COMPARISON_METRICS: Array<{
  key: keyof GenerationAggregate;
  label: string;
  higherIsBetter: boolean;
}> = [
  { key: 'schemaValidity', label: 'Schema Validity', higherIsBetter: true },
  { key: 'graphConnectivity', label: 'Graph Connectivity', higherIsBetter: true },
  { key: 'parameterCompleteness', label: 'Parameter Completeness', higherIsBetter: true },
  { key: 'nodeSelectionAccuracy', label: 'Node Selection', higherIsBetter: true },
  { key: 'intentCoverage', label: 'Intent Coverage', higherIsBetter: true },
  { key: 'constraintCoverage', label: 'Constraint Coverage', higherIsBetter: true },
  { key: 'executionSuccessRate', label: 'Execution Success', higherIsBetter: true },
  { key: 'taskCompletionRate', label: 'Task Completion', higherIsBetter: true },
  { key: 'repairRate', label: 'Repair Rate', higherIsBetter: false },
  { key: 'generationLatencyMs', label: 'Generation Latency', higherIsBetter: false },
  { key: 'inputTokens', label: 'Input Tokens', higherIsBetter: false },
  { key: 'outputTokens', label: 'Output Tokens', higherIsBetter: false },
  { key: 'estimatedCost', label: 'Estimated Cost', higherIsBetter: false },
  { key: 'averageScore', label: 'Average Score', higherIsBetter: true },
];

/**
 * A/B 对比：只比较可观测指标；未采集的指标显示 null，不编造胜负。
 */
export function compareGenerationReports(
  baseline: GenerationReport,
  candidate: GenerationReport,
): AbComparison {
  const metrics: AbMetricComparison[] = COMPARISON_METRICS.map((definition) => {
    const a = baseline.aggregate[definition.key] as number | null;
    const b = candidate.aggregate[definition.key] as number | null;

    if (a === null || b === null) {
      return { metric: definition.label, a, b, delta: null, better: 'tie' as const };
    }

    const delta = Math.round((b - a) * 1_000) / 1_000;
    const better =
      delta === 0
        ? ('tie' as const)
        : definition.higherIsBetter
          ? delta > 0
            ? ('b' as const)
            : ('a' as const)
          : delta < 0
            ? ('b' as const)
            : ('a' as const);

    return { metric: definition.label, a, b, delta, better };
  });

  const comparable = metrics.filter((item) => item.better !== 'tie');
  const bWins = comparable.filter((item) => item.better === 'b').length;
  const aWins = comparable.filter((item) => item.better === 'a').length;

  let winner: AbComparison['winner'] = 'tie';
  if (candidate.aggregate.averageScore > baseline.aggregate.averageScore + 2) winner = 'candidate';
  else if (baseline.aggregate.averageScore > candidate.aggregate.averageScore + 2) winner = 'baseline';
  else if (bWins > aWins) winner = 'candidate';
  else if (aWins > bWins) winner = 'baseline';

  const conclusion =
    winner === 'tie'
      ? `两组整体持平（均分 ${baseline.aggregate.averageScore} vs ${candidate.aggregate.averageScore}）`
      : `${winner === 'candidate' ? '候选' : '基线'}更优：均分 ${baseline.aggregate.averageScore} → ${candidate.aggregate.averageScore}，` +
        `指标胜出 ${winner === 'candidate' ? bWins : aWins} / ${comparable.length}`;

  return {
    baseline: {
      suiteVersion: baseline.suiteVersion,
      promptVersion: baseline.promptVersion,
      modelId: baseline.modelId,
    },
    candidate: {
      suiteVersion: candidate.suiteVersion,
      promptVersion: candidate.promptVersion,
      modelId: candidate.modelId,
    },
    metrics,
    winner,
    conclusion,
  };
}
