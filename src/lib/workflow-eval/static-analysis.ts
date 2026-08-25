/**
 * Workflow Static Analysis（Part 六）
 *
 * 执行前分析（不依赖 run 历史）：
 *   unused nodes / unreachable nodes / duplicate nodes / unnecessary LLM calls /
 *   serializable parallel operations / missing error handling / large context risk /
 *   potential infinite loops
 */

import type { TinyflowData } from '../tinyflow/types';

export type AnalysisSeverity = 'info' | 'warning' | 'error';

export interface AnalysisFinding {
  severity: AnalysisSeverity;
  code: string;
  nodeId?: string;
  nodeIds?: string[];
  message: string;
  suggestion?: string;
}

export interface StaticAnalysisResult {
  findings: AnalysisFinding[];
  /** 可并行节点对（无依赖、可并行提升性能） */
  parallelizable: Array<[string, string]>;
}

const LLM_TYPES = new Set(['llmNode']);

/** 串行可达路径：两节点是否在任一同一条依赖链上（决定是否可并行） */
function isDependent(a: string, b: string, flow: TinyflowData): boolean {
  const adj = new Map<string, string[]>();
  for (const n of flow.nodes) {
    if (!adj.has(n.id)) adj.set(n.id, []);
  }
  for (const e of flow.edges) {
    adj.get(e.source)?.push(e.target);
  }
  const reachable = (from: string, target: string): boolean => {
    const visited = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === target) return true;
      if (visited.has(cur)) continue;
      visited.add(cur);
      stack.push(...(adj.get(cur) ?? []));
    }
    return false;
  };
  return reachable(a, b) || reachable(b, a);
}

/** 是否需要错误处理（易失败节点类型） */
const ERROR_PRONE = new Set(['httpNode', 'llmNode', 'searchEngineNode', 'knowledgeNode']);

export function analyzeWorkflow(flow: TinyflowData): StaticAnalysisResult {
  const findings: AnalysisFinding[] = [];
  const nodeIds = new Set(flow.nodes.map((n) => n.id));
  const reachable = computeReachable(flow);

  // 1. unused nodes：无入边且非 start；或出度为0且非 end
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const n of flow.nodes) { inDegree.set(n.id, 0); outDegree.set(n.id, 0); }
  for (const e of flow.edges) {
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    outDegree.set(e.source, (outDegree.get(e.source) ?? 0) + 1);
  }
  for (const n of flow.nodes) {
    if (n.type === 'startNode') continue;
    if (inDegree.get(n.id) === 0) {
      findings.push({
        severity: 'warning',
        code: 'unused_node',
        nodeId: n.id,
        message: `节点「${n.data.title || n.id}」没有入边，可能永远不会被执行`,
        suggestion: '确认是否有遗漏的连接，或删除该节点',
      });
    }
  }
  for (const n of flow.nodes) {
    if (n.type === 'endNode') continue;
    if (n.parentId) continue; // loop 子节点
    if (outDegree.get(n.id) === 0) {
      findings.push({
        severity: 'warning',
        code: 'dangling_node',
        nodeId: n.id,
        message: `节点「${n.data.title || n.id}」没有出边（不是结束节点）`,
        suggestion: '补充到下游的连接，或改为结束节点',
      });
    }
  }

  // 2. unreachable nodes：从 start 不可达
  for (const n of flow.nodes) {
    if (n.type === 'startNode') continue;
    if (!reachable.has(n.id)) {
      findings.push({
        severity: 'warning',
        code: 'unreachable_node',
        nodeId: n.id,
        message: `节点「${n.data.title || n.id}」从开始节点不可达`,
        suggestion: '该节点不会被执行，检查是否缺少连接',
      });
    }
  }

  // 3. duplicate nodes：同类型 + 相同关键配置（近似）
  const seen = new Map<string, string>();
  for (const n of flow.nodes) {
    if (n.type === 'startNode' || n.type === 'endNode') continue;
    const key = `${n.type}::${JSON.stringify(n.data?.prompt ?? n.data?.code ?? n.data?.url ?? '')}`;
    if (seen.has(key)) {
      findings.push({
        severity: 'info',
        code: 'duplicate_node',
        nodeId: n.id,
        nodeIds: [seen.get(key)!, n.id],
        message: `节点「${n.data.title || n.id}」与「${seen.get(key)}」配置高度相似`,
        suggestion: '考虑合并或复用上游输出',
      });
    } else {
      seen.set(key, n.id);
    }
  }

  // 4. unnecessary LLM calls：相邻两个 LLM 节点（同一链上直接相连）
  for (const e of flow.edges) {
    const src = flow.nodes.find((n) => n.id === e.source);
    const dst = flow.nodes.find((n) => n.id === e.target);
    if (src && dst && LLM_TYPES.has(src.type) && LLM_TYPES.has(dst.type)) {
      findings.push({
        severity: 'info',
        code: 'unnecessary_llm_call',
        nodeId: dst.id,
        message: `两个 LLM 节点直接相连（「${src.data.title}」→「${dst.data.title}」）`,
        suggestion: '考虑合并为一次调用，减少延迟与成本',
      });
    }
  }

  // 5. serializable parallel operations：找出无依赖的节点对（输出到 parallelizable）
  const parallelizable: Array<[string, string]> = [];
  const arr = flow.nodes.filter((n) => !n.parentId && n.type !== 'startNode' && n.type !== 'endNode');
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i];
      const b = arr[j];
      if (!isDependent(a.id, b.id, flow)) {
        parallelizable.push([a.id, b.id]);
      }
    }
  }

  // 6. missing error handling：易失败节点未配置重试
  for (const n of flow.nodes) {
    if (ERROR_PRONE.has(n.type)) {
      const data = n.data as Record<string, unknown>;
      if (data.retryEnable !== true) {
        findings.push({
          severity: 'warning',
          code: 'missing_error_handling',
          nodeId: n.id,
          message: `节点「${n.data.title || n.id}」(${n.type}) 为外部调用/模型类节点，但未开启重试`,
          suggestion: '在节点配置中启用 retryEnable，网络抖动可自动重试',
        });
      }
    }
  }

  // 7. large context risk：LLM 节点 prompt/输入过大 或 template 超大
  for (const n of flow.nodes) {
    const data = n.data as Record<string, unknown>;
    const userPrompt = String(data.userPrompt ?? '');
    const systemPrompt = String(data.systemPrompt ?? '');
    const template = String(data.template ?? '');
    const approxTokens = Math.round((userPrompt.length + systemPrompt.length + template.length) / 3);
    if (approxTokens > 12000) {
      findings.push({
        severity: 'warning',
        code: 'large_context_risk',
        nodeId: n.id,
        message: `节点「${n.data.title || n.id}」文本量约 ${approxTokens} tokens，可能接近上下文上限`,
        suggestion: '精简提示词，或拆分处理',
      });
    }
  }

  // 8. potential infinite loops：loop 未设置上限或循环体无 break
  for (const n of flow.nodes) {
    if (n.type === 'loopNode') {
      const data = n.data as Record<string, unknown>;
      const maxLoop = Number(data.maxLoopCount ?? 0);
      if (data.loopEnable !== true) continue;
      if (maxLoop <= 0 || maxLoop > 100000) {
        findings.push({
          severity: 'error',
          code: 'potential_infinite_loop',
          nodeId: n.id,
          message: `循环节点「${n.data.title || n.id}」未设置合理上限（当前 ${maxLoop || '无'}）`,
          suggestion: '设置有限的 maxLoopCount，并配置中断条件',
        });
      }
    }
  }

  // 9. 缺少开始/结束
  if (!flow.nodes.some((n) => n.type === 'startNode')) {
    findings.push({ severity: 'error', code: 'missing_start', message: '缺少开始节点' });
  }
  if (!flow.nodes.some((n) => n.type === 'endNode')) {
    findings.push({ severity: 'error', code: 'missing_end', message: '缺少结束节点' });
  }

  return { findings, parallelizable };
}

function computeReachable(flow: TinyflowData): Set<string> {
  const start = flow.nodes.find((n) => n.type === 'startNode');
  if (!start) return new Set();
  const adj = new Map<string, string[]>();
  for (const n of flow.nodes) adj.set(n.id, []);
  for (const e of flow.edges) adj.get(e.source)?.push(e.target);

  const seen = new Set<string>();
  const stack = [start.id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(adj.get(cur) ?? []));
  }
  return seen;
}