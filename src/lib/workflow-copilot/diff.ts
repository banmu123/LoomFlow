/**
 * Workflow Version Diff（Part 3）
 *
 * 计算两个工作流版本之间的改动，输出「AI 可读」的操作序列：
 *   add_node / remove_node / update_node / move_node
 *   add_edge / remove_edge
 *   update_workflow_metadata
 *
 * 同时提供人类可读的 markdown 摘要（UX 展示用）。
 */

import type { TinyflowData, FlowNode, FlowEdge } from '../tinyflow/types';

export type DiffOp =
  | 'add_node'
  | 'remove_node'
  | 'update_node'
  | 'move_node'
  | 'add_edge'
  | 'remove_edge'
  | 'update_workflow_metadata';

export interface NodeChange {
  field: string;
  before?: unknown;
  after?: unknown;
}

export interface WorkflowDiffOperation {
  op: DiffOp;
  nodeId?: string;
  edgeId?: string;
  /** add/update：目标内容或变更详情 */
  node?: FlowNode;
  edge?: FlowEdge;
  /** update_node：字段级变更列表 */
  changes?: NodeChange[];
  /** update_workflow_metadata */
  metadata?: { field: string; before?: unknown; after?: unknown };
  /** 人类可读说明（AI 生成或自动） */
  description?: string;
}

export interface WorkflowDiffResult {
  fromVersion?: number;
  toVersion?: number;
  operations: WorkflowDiffOperation[];
  summary: {
    addedNodes: number;
    removedNodes: number;
    updatedNodes: number;
    addedEdges: number;
    removedEdges: number;
  };
}

type Primitive = string | number | boolean | null | undefined;

/** 仅比较标量/浅层的字段差异（忽略 position 之外的嵌套，data 单独处理） */
function shallowDiff(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): NodeChange[] {
  const changes: NodeChange[] = [];
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const k of keys) {
    const b = before?.[k];
    const a = after?.[k];
    if (JSON.stringify(b ?? null) !== JSON.stringify(a ?? null)) {
      changes.push({ field: k, before: b, after: a });
    }
  }
  return changes;
}

/** 对比节点 data（排除 expand 展开状态等画布噪音） */
function diffNodeData(before: FlowNode, after: FlowNode): NodeChange[] {
  const strip = (d: Record<string, unknown>): Record<string, unknown> => {
    const { expand, selected, ...rest } = d as Record<string, unknown>;
    return rest;
  };
  return shallowDiff(strip(before.data as Record<string, unknown>), strip(after.data as Record<string, unknown>));
}

/** 计算两版工作流 diff（before = 旧版，after = 新版） */
export function diffWorkflow(
  before: TinyflowData,
  after: TinyflowData,
  versions?: { from?: number; to?: number },
): WorkflowDiffResult {
  const beforeNodes = new Map(before.nodes.map((n) => [n.id, n]));
  const afterNodes = new Map(after.nodes.map((n) => [n.id, n]));
  const beforeEdges = new Map(before.edges.map((e) => [e.id, e]));
  const afterEdges = new Map(after.edges.map((e) => [e.id, e]));

  const operations: WorkflowDiffOperation[] = [];

  // 节点增删
  for (const [id, node] of afterNodes) {
    if (!beforeNodes.has(id)) {
      operations.push({
        op: 'add_node',
        nodeId: id,
        node,
        description: `新增节点「${(node.data as { title?: string }).title || id}」(${node.type})`,
      });
    }
  }
  for (const [id, node] of beforeNodes) {
    if (!afterNodes.has(id)) {
      operations.push({
        op: 'remove_node',
        nodeId: id,
        node,
        description: `删除节点「${(node.data as { title?: string }).title || id}」`,
      });
    }
  }

  // 节点字段更新：先 data，再 position
  for (const [id, beforeNode] of beforeNodes) {
    const afterNode = afterNodes.get(id);
    if (!afterNode) continue;
    const dataChanges = diffNodeData(beforeNode, afterNode);
    const positionChanged =
      JSON.stringify(beforeNode.position) !== JSON.stringify(afterNode.position);
    if (dataChanges.length > 0) {
      operations.push({
        op: 'update_node',
        nodeId: id,
        changes: dataChanges,
        description: `更新节点「${(afterNode.data as { title?: string }).title || id}」配置`,
      });
    }
    if (positionChanged) {
      operations.push({
        op: 'move_node',
        nodeId: id,
        changes: [{ field: 'position', before: beforeNode.position, after: afterNode.position }],
        description: `移动节点「${(afterNode.data as { title?: string }).title || id}」`,
      });
    }
  }

  // 边增删
  for (const [id, edge] of afterEdges) {
    if (!beforeEdges.has(id)) {
      operations.push({ op: 'add_edge', edgeId: id, edge, description: `新增连接 ${edge.source} → ${edge.target}` });
    }
  }
  for (const [id, edge] of beforeEdges) {
    if (!afterEdges.has(id)) {
      operations.push({ op: 'remove_edge', edgeId: id, edge, description: `删除连接 ${edge.source} → ${edge.target}` });
    }
  }

  // 元数据
  const metaOps: WorkflowDiffOperation[] = [];
  const metaFields = ['title', 'description'] as const;
  for (const f of metaFields) {
    const b = (before as unknown as Record<string, unknown>)[f];
    const a = (after as unknown as Record<string, unknown>)[f];
    if (JSON.stringify(b ?? null) !== JSON.stringify(a ?? null)) {
      metaOps.push({
        op: 'update_workflow_metadata',
        metadata: { field: f, before: b, after: a },
        description: `更新工作流${f === 'title' ? '标题' : '描述'}`,
      });
    }
  }
  operations.push(...metaOps);

  const summary = {
    addedNodes: operations.filter((o) => o.op === 'add_node').length,
    removedNodes: operations.filter((o) => o.op === 'remove_node').length,
    updatedNodes: operations.filter((o) => o.op === 'update_node').length,
    addedEdges: operations.filter((o) => o.op === 'add_edge').length,
    removedEdges: operations.filter((o) => o.op === 'remove_edge').length,
  };

  return {
    fromVersion: versions?.from,
    toVersion: versions?.to,
    operations,
    summary,
  };
}

/** 生成人类可读的 markdown diff（供 AI proposal 面板显示） */
export function diffToMarkdown(diff: WorkflowDiffResult): string {
  if (diff.operations.length === 0) return '*（无改动）*';
  const lines: string[] = [];
  const prefix: Record<DiffOp, string> = {
    add_node: '+ ➕ 节点',
    remove_node: '- 🗑 节点',
    update_node: '~ ✏️ 节点',
    move_node: '↔️ 节点',
    add_edge: '+ 🔗 连接',
    remove_edge: '- 🔗 连接',
    update_workflow_metadata: '~ 📝 元数据',
  };
  for (const op of diff.operations) {
    let line = `${prefix[op.op]}：${op.description ?? ''}`;
    if (op.op === 'update_node' && op.changes) {
      line += `（${op.changes.map((c) => `${c.field}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`).join('，')}）`;
    }
    lines.push(line);
  }
  lines.push(
    `\n**统计**：+${diff.summary.addedNodes} 节点 / -${diff.summary.removedNodes} 节点 / ~${diff.summary.updatedNodes} 节点 / +${diff.summary.addedEdges} 连接 / -${diff.summary.removedEdges} 连接`,
  );
  return lines.join('\n');
}
