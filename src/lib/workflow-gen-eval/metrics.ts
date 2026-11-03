import { validateWorkflow } from '@/lib/tinyflow/schema';
// 副作用导入：确保 NodeRegistry 已注册内置节点（评测需要真实的节点类型清单）
import '@/lib/tinyflow/nodes/builtin';
import { nodeRegistry } from '@/lib/tinyflow/node-registry';
import type { TinyflowData, FlowNode } from '@/lib/tinyflow/types';
import type {
  BenchmarkCase,
  BenchmarkConstraint,
  BenchmarkNodeType,
  CaseEvaluation,
  CaseStructuralResult,
  CaseSemanticResult,
  CaseExecutionResult,
} from './types';

/** 各节点类型的必填配置（与 executor.validate 对齐的确定性字段） */
const REQUIRED_PARAMS: Partial<Record<BenchmarkNodeType, string[]>> = {
  llmNode: ['llmId'],
  httpNode: ['url'],
  codeNode: ['code'],
  knowledgeNode: ['knowledgeId'],
  conditionNode: ['condition'],
  templateNode: ['template'],
  agentNode: ['goal', 'llmId', 'mcpServerId'],
  pythonToolNode: ['tool'],
};

const FALLBACK_TYPES = new Set<string>([
  'startNode',
  'endNode',
  'llmNode',
  'httpNode',
  'codeNode',
  'knowledgeNode',
  'searchEngineNode',
  'templateNode',
  'conditionNode',
  'confirmNode',
  'loopNode',
  'excelNode',
  'pythonToolNode',
  'agentNode',
]);

function knownNodeTypes(): Set<string> {
  const registered = new Set(nodeRegistry.list().map((node) => node.type));
  return registered.size > 0 ? registered : FALLBACK_TYPES;
}

function nodesOf(flow: TinyflowData): FlowNode[] {
  return Array.isArray(flow.nodes) ? flow.nodes : [];
}

function edgesOf(flow: TinyflowData): Array<{ source: string; target: string }> {
  return Array.isArray(flow.edges) ? flow.edges : [];
}

function typeOf(flow: TinyflowData, nodeId: string): string | undefined {
  return nodesOf(flow).find((node) => node.id === nodeId)?.type;
}

function hasEdgeBetween(flow: TinyflowData, from: BenchmarkNodeType, to: BenchmarkNodeType): boolean {
  return edgesOf(flow).some(
    (edge) => typeOf(flow, edge.source) === from && typeOf(flow, edge.target) === to,
  );
}

function reachableFrom(flow: TinyflowData, startId: string): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edgesOf(flow)) {
    const list = adjacency.get(edge.source) ?? [];
    list.push(edge.target);
    adjacency.set(edge.source, list);
  }

  const visited = new Set<string>();
  const stack = [startId];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) stack.push(next);
    }
  }
  return visited;
}

function hasCycle(flow: TinyflowData): boolean {
  const colors = new Map<string, 0 | 1 | 2>();
  const adjacency = new Map<string, string[]>();
  for (const edge of edgesOf(flow)) {
    const list = adjacency.get(edge.source) ?? [];
    list.push(edge.target);
    adjacency.set(edge.source, list);
  }

  const visit = (nodeId: string): boolean => {
    const color = colors.get(nodeId) ?? 0;
    if (color === 1) return true;
    if (color === 2) return false;
    colors.set(nodeId, 1);
    for (const next of adjacency.get(nodeId) ?? []) {
      if (visit(next)) return true;
    }
    colors.set(nodeId, 2);
    return false;
  };

  return nodesOf(flow).some((node) => visit(node.id));
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function evaluateStructure(caseDef: BenchmarkCase, workflow: TinyflowData | null): CaseStructuralResult {
  const issues: string[] = [];
  if (!workflow) {
    return {
      schemaValid: false,
      nodeTypeValid: false,
      graphConnected: false,
      parametersComplete: false,
      structureScore: 0,
      issues: ['生成失败：没有工作流数据'],
    };
  }

  const schema = validateWorkflow(workflow);
  if (!schema.valid) {
    for (const error of schema.errors.slice(0, 5)) issues.push(`schema: ${error.message}`);
  }

  const known = knownNodeTypes();
  const types = nodesOf(workflow).map((node) => node.type);
  const unknown = types.filter((type) => !known.has(type));
  const nodeTypeValid = unknown.length === 0;
  if (!nodeTypeValid) issues.push(`未知节点类型：${[...new Set(unknown)].join(', ')}`);

  const nodes = nodesOf(workflow);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const start = nodes.find((node) => node.type === 'startNode');
  const end = nodes.find((node) => node.type === 'endNode');

  let graphConnected = false;
  if (!start || !end) {
    issues.push(start ? '缺少 endNode' : '缺少 startNode');
  } else {
    const reachable = reachableFrom(workflow, start.id);
    const dangling = edgesOf(workflow).filter(
      (edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target),
    );
    const orphans = nodes.filter(
      (node) => node.type !== 'startNode' && !edgesOf(workflow).some((edge) => edge.target === node.id),
    );

    graphConnected = reachable.has(end.id) && dangling.length === 0 && orphans.length === 0;
    if (!reachable.has(end.id)) issues.push('endNode 不可从 startNode 到达');
    if (orphans.length > 0) issues.push(`存在孤立节点：${orphans.map((n) => n.id).join(', ')}`);
    if (dangling.length > 0) issues.push('存在指向不存在节点的边');
  }

  const missingParams: string[] = [];
  for (const node of nodes) {
    const required = REQUIRED_PARAMS[node.type as BenchmarkNodeType];
    if (!required) continue;
    const data = (node.data ?? {}) as Record<string, unknown>;
    for (const field of required) {
      if (isBlank(data[field])) missingParams.push(`${node.type}.${field}`);
    }
  }
  const parametersComplete = missingParams.length === 0;
  if (!parametersComplete) issues.push(`缺少必填参数：${missingParams.join(', ')}`);

  // Schema 40 / 节点类型 20 / 连通性 25 / 参数 15
  const structureScore = Math.round(
    (schema.valid ? 40 : 0) +
      (nodeTypeValid ? 20 : 0) +
      (graphConnected ? 25 : 0) +
      (parametersComplete ? 15 : 0),
  );

  return {
    schemaValid: schema.valid,
    nodeTypeValid,
    graphConnected,
    parametersComplete,
    structureScore,
    issues,
  };
}

function constraintSatisfied(
  constraint: BenchmarkConstraint,
  workflow: TinyflowData,
): boolean {
  switch (constraint.type) {
    case 'edge_between':
      return hasEdgeBetween(workflow, constraint.from, constraint.to);
    case 'node_count_min':
      return nodesOf(workflow).length >= constraint.min;
    case 'node_count_max':
      return nodesOf(workflow).length <= constraint.max;
    case 'param_present': {
      const node = nodesOf(workflow).find((item) => item.type === constraint.nodeType);
      if (!node) return false;
      const data = (node.data ?? {}) as Record<string, unknown>;
      return !isBlank(data[constraint.field]);
    }
    case 'forbid_node':
      return !nodesOf(workflow).some((node) => node.type === constraint.nodeType);
    default:
      return false;
  }
}

export function evaluateSemantics(caseDef: BenchmarkCase, workflow: TinyflowData | null): CaseSemanticResult {
  if (!workflow) {
    return {
      nodeSelection: 0,
      intentCoverage: 0,
      constraintCoverage: 0,
      forbiddenUsed: [],
      satisfied: [],
      violated: caseDef.constraints.map((item) => describeConstraint(item)),
      semanticScore: 0,
    };
  }

  const presentTypes = new Set(nodesOf(workflow).map((node) => node.type));
  const forbiddenUsed = caseDef.forbiddenNodeTypes.filter((type) => presentTypes.has(type));

  const expectedHits = caseDef.expectedNodeTypes.filter((type) => presentTypes.has(type));
  const baseSelection =
    caseDef.expectedNodeTypes.length === 0
      ? 1
      : expectedHits.length / caseDef.expectedNodeTypes.length;
  const nodeSelection = Math.max(0, baseSelection - forbiddenUsed.length * 0.25);

  const satisfied: string[] = [];
  const violated: string[] = [];
  for (const constraint of caseDef.constraints) {
    if (constraintSatisfied(constraint, workflow)) satisfied.push(describeConstraint(constraint));
    else violated.push(describeConstraint(constraint));
  }
  const constraintCoverage =
    caseDef.constraints.length === 0 ? 1 : satisfied.length / caseDef.constraints.length;

  // 意图覆盖的确定性代理：期望节点类型 + 带标签的边约束（不假装理解自然语言）
  const evidence: boolean[] = [
    ...caseDef.expectedNodeTypes.map((type) => presentTypes.has(type)),
    ...caseDef.constraints
      .filter((constraint) => constraint.type === 'edge_between' && constraint.label)
      .map((constraint) => constraintSatisfied(constraint, workflow)),
  ];
  const intentCoverage =
    evidence.length === 0 ? 0 : evidence.filter(Boolean).length / evidence.length;

  const semanticScore = Math.round(
    (nodeSelection * 40 + intentCoverage * 35 + constraintCoverage * 25),
  );

  return {
    nodeSelection: round2(nodeSelection),
    intentCoverage: round2(intentCoverage),
    constraintCoverage: round2(constraintCoverage),
    forbiddenUsed,
    satisfied,
    violated,
    semanticScore,
  };
}

function describeConstraint(constraint: BenchmarkConstraint): string {
  switch (constraint.type) {
    case 'edge_between':
      return `${constraint.from} → ${constraint.to}${constraint.label ? `（${constraint.label}）` : ''}`;
    case 'node_count_min':
      return `节点数 ≥ ${constraint.min}`;
    case 'node_count_max':
      return `节点数 ≤ ${constraint.max}`;
    case 'param_present':
      return `${constraint.nodeType}.${constraint.field} 已填写`;
    case 'forbid_node':
      return `不得使用 ${constraint.nodeType}`;
    default:
      return '未知约束';
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function evaluateCase(
  caseDef: BenchmarkCase,
  workflow: TinyflowData | null,
  execution: CaseExecutionResult = { attempted: false, success: false, outputMatched: null },
): CaseEvaluation {
  const structural = evaluateStructure(caseDef, workflow);
  const semantic = evaluateSemantics(caseDef, workflow);

  const deterministicScore = Math.round(structural.structureScore * 0.55 + semantic.semanticScore * 0.45);
  const grade = deterministicScore >= 85 ? 'good' : deterministicScore >= 65 ? 'warn' : 'bad';

  return {
    caseId: caseDef.id,
    title: caseDef.title,
    structural,
    semantic,
    execution,
    deterministicScore,
    finalScore: deterministicScore,
    grade,
  };
}

/** Judge 只做补充，权重上限 20%，且不能救回结构失败的案例 */
export function applyJudge(
  evaluation: CaseEvaluation,
  judge: { score: number; reason: string; modelId: string; promptVersion: string },
): CaseEvaluation {
  if (!evaluation.structural.schemaValid) {
    return { ...evaluation, judge: { ...judge, weightedScore: evaluation.deterministicScore } };
  }

  const judgeScore = Math.max(0, Math.min(100, judge.score));
  const weightedScore = Math.round(
    evaluation.deterministicScore * 0.8 + judgeScore * 0.2,
  );

  return {
    ...evaluation,
    judge: { ...judge, weightedScore },
    finalScore: weightedScore,
    grade: weightedScore >= 85 ? 'good' : weightedScore >= 65 ? 'warn' : 'bad',
  };
}
