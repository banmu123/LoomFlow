import type { TinyflowData } from '@/lib/tinyflow/types';

/** 现有节点类型（与 NodeRegistry 保持一致，不虚构节点） */
export type BenchmarkNodeType =
  | 'startNode'
  | 'endNode'
  | 'llmNode'
  | 'httpNode'
  | 'codeNode'
  | 'knowledgeNode'
  | 'searchEngineNode'
  | 'templateNode'
  | 'conditionNode'
  | 'confirmNode'
  | 'loopNode'
  | 'excelNode'
  | 'pythonToolNode'
  | 'agentNode';

/** 可确定性校验的结构约束（不接受自然语言描述） */
export type BenchmarkConstraint =
  | { type: 'edge_between'; from: BenchmarkNodeType; to: BenchmarkNodeType; label?: string }
  | { type: 'node_count_min'; min: number }
  | { type: 'node_count_max'; max: number }
  | { type: 'param_present'; nodeType: BenchmarkNodeType; field: string }
  | { type: 'forbid_node'; nodeType: BenchmarkNodeType };

export interface BenchmarkCase {
  id: string;
  title: string;
  input: string;
  expectedIntent: string;
  expectedNodeTypes: BenchmarkNodeType[];
  forbiddenNodeTypes: BenchmarkNodeType[];
  constraints: BenchmarkConstraint[];
  /** 期望产物（人工复核参考；自动判定用 constraints，不用这段文字） */
  expectedOutput?: string;
  /** 该案例要启用的评测维度 */
  evaluationRules: Array<'schema' | 'semantics' | 'constraints' | 'execution'>;
}

export interface BenchmarkDataset {
  version: string;
  description: string;
  cases: BenchmarkCase[];
}

export interface GeneratedWorkflow {
  workflow: TinyflowData | null;
  /** 生成失败时的错误（Schema 解析失败 / 模型报错） */
  error?: string;
  /** 是否触发了自动修复 */
  repairAttempted?: boolean;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number | null;
}

export type WorkflowGenerator = (input: BenchmarkCase) => Promise<GeneratedWorkflow>;

export interface CaseStructuralResult {
  schemaValid: boolean;
  nodeTypeValid: boolean;
  graphConnected: boolean;
  parametersComplete: boolean;
  structureScore: number;
  issues: string[];
}

export interface CaseSemanticResult {
  nodeSelection: number;
  intentCoverage: number;
  constraintCoverage: number;
  forbiddenUsed: BenchmarkNodeType[];
  satisfied: string[];
  violated: string[];
  semanticScore: number;
}

export interface CaseExecutionResult {
  attempted: boolean;
  success: boolean;
  outputMatched: boolean | null;
  error?: string;
}

export interface CaseEvaluation {
  caseId: string;
  title: string;
  structural: CaseStructuralResult;
  semantic: CaseSemanticResult;
  execution: CaseExecutionResult;
  /** 0-100，确定性规则加权；不含 Judge */
  deterministicScore: number;
  judge?: {
    score: number;
    reason: string;
    modelId: string;
    promptVersion: string;
    /** Judge 只作为补充，权重上限 20% */
    weightedScore: number;
  };
  finalScore: number;
  grade: 'good' | 'warn' | 'bad';
}

export interface GenerationAggregate {
  cases: number;
  schemaValidity: number;
  nodeTypeValidity: number;
  graphConnectivity: number;
  parameterCompleteness: number;
  nodeSelectionAccuracy: number;
  intentCoverage: number;
  constraintCoverage: number;
  structureQuality: number;
  executionSuccessRate: number | null;
  taskCompletionRate: number | null;
  repairRate: number;
  generationLatencyMs: number;
  executionLatencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number | null;
  averageScore: number;
}

export interface GenerationReport {
  suiteVersion: string;
  promptVersion: string;
  modelId: string | null;
  temperature: number | null;
  generatedAt: string;
  cases: CaseEvaluation[];
  aggregate: GenerationAggregate;
  thresholds: GenerationThresholds;
  decision: 'allow' | 'warning' | 'block';
}

export interface GenerationThresholds {
  /** 低于该总分 → block */
  blockScore: number;
  /** 低于该总分 → warning */
  warnScore: number;
  /** Schema 合法率下限（低于则直接 block） */
  minSchemaValidity: number;
  /** 任务完成率下限（有执行数据时生效） */
  minTaskCompletion: number;
}

export const DEFAULT_GENERATION_THRESHOLDS: GenerationThresholds = {
  blockScore: 60,
  warnScore: 80,
  minSchemaValidity: 0.95,
  minTaskCompletion: 0.7,
};

export interface AbMetricComparison {
  metric: string;
  a: number | null;
  b: number | null;
  delta: number | null;
  better: 'a' | 'b' | 'tie';
}

export interface AbComparison {
  baseline: { suiteVersion: string; promptVersion: string; modelId: string | null };
  candidate: { suiteVersion: string; promptVersion: string; modelId: string | null };
  metrics: AbMetricComparison[];
  winner: 'baseline' | 'candidate' | 'tie';
  conclusion: string;
}
