import type { TinyflowData } from './types';
import { GraphParser } from './engine/GraphParser';

// ===== Workflow Schema v1 =====
// Workflow 定义成为可保存、分享、校验、迁移的开发者资产

export const WORKFLOW_SCHEMA_VERSION = 1;

// 已知节点类型（与 ExecutorRegistry 保持一致）
export const KNOWN_NODE_TYPES = [
  'startNode',
  'endNode',
  'llmNode',
  'httpNode',
  'codeNode',
  'knowledgeNode',
  'searchEngineNode',
  'templateNode',
  'confirmNode',
  'loopNode',
] as const;

export interface WorkflowValidationError {
  code: string; // missing_field / unknown_type / duplicate_id / dangling_edge / self_loop / cycle / missing_start / missing_end / invalid_config
  nodeId?: string;
  message: string;
}

export interface WorkflowValidationResult {
  valid: boolean;
  errors: WorkflowValidationError[];
}

// ===== 校验 =====

export function validateWorkflow(data: unknown): WorkflowValidationResult {
  const errors: WorkflowValidationError[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: [{ code: 'invalid_flow', message: '工作流数据不是有效对象' }] };
  }

  const flow = data as TinyflowData;

  // nodes / edges 结构
  if (!Array.isArray(flow.nodes)) {
    errors.push({ code: 'missing_field', message: '缺少 nodes 数组' });
  }
  if (!Array.isArray(flow.edges)) {
    errors.push({ code: 'missing_field', message: '缺少 edges 数组' });
  }
  if (errors.length > 0) return { valid: false, errors };

  const nodes = flow.nodes;
  const edges = flow.edges;

  // 节点 id 唯一性 + 类型合法性
  const seenIds = new Set<string>();
  let hasStart = false;
  let hasEnd = false;

  for (const node of nodes) {
    if (!node.id) {
      errors.push({ code: 'missing_field', message: '节点缺少 id' });
      continue;
    }
    if (seenIds.has(node.id)) {
      errors.push({ code: 'duplicate_id', nodeId: node.id, message: `节点 id 重复: ${node.id}` });
    }
    seenIds.add(node.id);

    if (!node.type) {
      errors.push({ code: 'missing_field', nodeId: node.id, message: `节点 ${node.id} 缺少 type` });
    } else if (!KNOWN_NODE_TYPES.includes(node.type as (typeof KNOWN_NODE_TYPES)[number])) {
      errors.push({
        code: 'unknown_type',
        nodeId: node.id,
        message: `未知节点类型: ${node.type}（节点 ${node.id}）`,
      });
    }

    if (node.type === 'startNode') hasStart = true;
    if (node.type === 'endNode') hasEnd = true;
  }

  if (!hasStart) {
    errors.push({ code: 'missing_start', message: '缺少开始节点（startNode）' });
  }
  if (!hasEnd) {
    errors.push({ code: 'missing_end', message: '缺少结束节点（endNode）' });
  }

  // 连接合法性
  for (const edge of edges) {
    if (!edge.source || !seenIds.has(edge.source)) {
      errors.push({
        code: 'dangling_edge',
        message: `连接 ${edge.id || '?'} 的起点不存在: ${edge.source}`,
      });
    }
    if (!edge.target || !seenIds.has(edge.target)) {
      errors.push({
        code: 'dangling_edge',
        message: `连接 ${edge.id || '?'} 的终点不存在: ${edge.target}`,
      });
    }
    if (edge.source && edge.source === edge.target) {
      errors.push({
        code: 'self_loop',
        message: `连接 ${edge.id || '?'} 存在自环: ${edge.source}`,
      });
    }
  }

  // 循环依赖检测（拓扑排序抛错 = 有环）
  if (errors.length === 0 && nodes.length > 1) {
    try {
      new GraphParser(flow).topologicalSort();
    } catch {
      errors.push({ code: 'cycle', message: '工作流存在循环依赖' });
    }
  }

  return { valid: errors.length === 0, errors };
}

// ===== 序列化 =====

// 规范化工作流：补充 metadata（幂等，可在执行前调用）
export function serializeWorkflow(data: TinyflowData, meta?: { title?: string; createdAt?: string }): TinyflowData & {
  metadata: { schemaVersion: number; title?: string; createdAt?: string };
} {
  return {
    ...data,
    metadata: {
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      title: meta?.title,
      createdAt: meta?.createdAt,
    },
  };
}

// ===== 迁移 =====

// 迁移旧版本工作流到当前 schema（当前仅 v1，预留扩展）
export function migrateWorkflow(data: unknown): TinyflowData {
  const flow = (data ?? {}) as TinyflowData;
  // v1 → 当前：确保 viewport 存在
  if (!flow.viewport) {
    flow.viewport = { x: 0, y: 0, zoom: 1 };
  }
  return flow;
}

// ===== 便捷方法 =====

// 校验失败时提取可读错误摘要
export function workflowErrorSummary(result: WorkflowValidationResult): string {
  if (result.valid) return '';
  return result.errors.map((e) => e.message).join('；');
}
