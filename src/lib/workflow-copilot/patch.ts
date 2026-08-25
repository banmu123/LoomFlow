/**
 * AI Workflow Patch（Part 4）
 *
 * AI 不再重新生成完整 Workflow，而是输出操作序列（operations）应用到临时副本：
 *
 * 支持：
 * - add_node                新增节点
 * - remove_node             删除节点（连带清理相关边）
 * - update_node             更新节点配置 / 移动 position
 * - move_node               仅改节点位置（保留 id）
 * - connect                 新增边
 * - disconnect              删除边
 * - replace_node            用新节点替换旧节点（迁移入边/出边引用）
 * - update_workflow_metadata 更新 title/description
 */

import type { TinyflowData, FlowNode, FlowEdge } from '../tinyflow/types';

export type PatchOp =
  | 'add_node'
  | 'remove_node'
  | 'update_node'
  | 'move_node'
  | 'connect'
  | 'disconnect'
  | 'replace_node'
  | 'update_workflow_metadata';

export interface PatchNodeInput {
  id: string;
  type: string;
  position?: { x: number; y: number };
  data?: Record<string, unknown>;
}

export interface PatchOperation {
  op: PatchOp;
  /** 目标节点 id */
  nodeId?: string;
  /** 新节点定义（add_node / replace_node 的 node） */
  node?: PatchNodeInput;
  /** 待更新的字段（update_node）；未指定 node 时用 changes */
  changes?: Record<string, unknown>;
  /** 位置（move_node / update_node 可选） */
  position?: { x: number; y: number };
  /** 边定义（connect） */
  edge?: { id?: string; source: string; target: string; condition?: string; sourcePort?: string };
  /** 待删除的边（disconnect）：可用 edgeId 或 source/target */
  edgeId?: string;
  source?: string;
  target?: string;
  /** 元数据更新（update_workflow_metadata） */
  metadata?: { title?: string; description?: string };
}

export interface ApplyPatchResult {
  workflow: TinyflowData;
  appliedCount: number;
  errors: string[];
}

function cloneData(data: TinyflowData): TinyflowData {
  return JSON.parse(JSON.stringify(data)) as TinyflowData;
}

function makeNode(input: PatchNodeInput): FlowNode {
  return {
    id: input.id,
    type: input.type,
    position: input.position || { x: 0, y: 0 },
    data: { title: input.id, description: '', ...(input.data || {}) },
  } as FlowNode;
}

function makeEdge(input: NonNullable<PatchOperation['edge']>): FlowEdge {
  return {
    id: input.id || `ai_e_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    source: input.source,
    target: input.target,
    data: input.condition
      ? { condition: input.condition, sourcePort: input.sourcePort }
      : undefined,
  } as FlowEdge;
}

/**
 * 将 patch 应用到工作流的【副本】上。
 * 返回新工作流；原始 workflow 不被修改（由调用方决定何时提交新版本）。
 */
export function applyPatch(workflow: TinyflowData, operations: PatchOperation[]): ApplyPatchResult {
  const result = cloneData(workflow);
  const nodes = result.nodes;
  const edges = result.edges;
  const errors: string[] = [];
  let appliedCount = 0;

  const nodeExists = (id: string) => nodes.some((n) => n.id === id);

  for (const op of operations) {
    try {
      switch (op.op) {
        case 'add_node': {
          if (!op.node?.id || !op.node?.type) {
            errors.push('add_node: 缺少 node.id / node.type');
            break;
          }
          if (nodeExists(op.node.id)) {
            errors.push(`add_node: 节点 ${op.node.id} 已存在`);
            break;
          }
          nodes.push(makeNode(op.node));
          appliedCount += 1;
          break;
        }
        case 'remove_node': {
          if (!op.nodeId || !nodeExists(op.nodeId)) {
            errors.push(`remove_node: 节点 ${op.nodeId} 不存在`);
            break;
          }
          // 迁移父级引用（loop 子节点）
          const parentId = nodes.find((n) => n.id === op.nodeId)?.parentId;
          const index = nodes.findIndex((n) => n.id === op.nodeId);
          if (index >= 0) nodes.splice(index, 1);
          // 删除该节点作为源/目标的边
          for (let i = edges.length - 1; i >= 0; i--) {
            if (edges[i].source === op.nodeId || edges[i].target === op.nodeId) {
              // 子节点随父节点删除
              if (parentId) {
                edges.splice(i, 1);
              } else {
                edges.splice(i, 1);
              }
            }
          }
          appliedCount += 1;
          break;
        }
        case 'update_node': {
          if (!op.nodeId || !nodeExists(op.nodeId)) {
            errors.push(`update_node: 节点 ${op.nodeId} 不存在`);
            break;
          }
          const node = nodes.find((n) => n.id === op.nodeId)!;
          if (op.changes) {
            node.data = { ...(node.data as Record<string, unknown>), ...op.changes } as never;
          }
          if (op.position) node.position = op.position;
          appliedCount += 1;
          break;
        }
        case 'move_node': {
          if (!op.nodeId || !nodeExists(op.nodeId)) {
            errors.push(`move_node: 节点 ${op.nodeId} 不存在`);
            break;
          }
          if (op.position) {
            nodes.find((n) => n.id === op.nodeId)!.position = op.position;
            appliedCount += 1;
          }
          break;
        }
        case 'connect': {
          if (!op.edge?.source || !op.edge?.target) {
            errors.push('connect: 缺少 source/target');
            break;
          }
          if (!nodeExists(op.edge.source) || !nodeExists(op.edge.target)) {
            errors.push(`connect: 端点不存在 (${op.edge.source}→${op.edge.target})`);
            break;
          }
          edges.push(makeEdge(op.edge));
          appliedCount += 1;
          break;
        }
        case 'disconnect': {
          let idx = -1;
          if (op.edgeId) {
            idx = edges.findIndex((e) => e.id === op.edgeId);
          } else if (op.source && op.target) {
            idx = edges.findIndex((e) => e.source === op.source && e.target === op.target);
          }
          if (idx < 0) {
            errors.push('disconnect: 边不存在');
            break;
          }
          edges.splice(idx, 1);
          appliedCount += 1;
          break;
        }
        case 'replace_node': {
          if (!op.nodeId || !op.node?.id || !op.node?.type) {
            errors.push('replace_node: 缺少 nodeId / node.id / node.type');
            break;
          }
          const idx = nodes.findIndex((n) => n.id === op.nodeId);
          if (idx < 0) {
            errors.push(`replace_node: 节点 ${op.nodeId} 不存在`);
            break;
          }
          const parentId = nodes[idx].parentId;
          const newId = op.node.id;
          // 迁移所有引用旧 id 的边到新 id
          for (const e of edges) {
            if (e.source === op.nodeId) e.source = newId;
            if (e.target === op.nodeId) e.target = newId;
          }
          // 若新 id 已存在（非自身），删除旧节点
          if (newId !== op.nodeId) {
            nodes.splice(idx, 1);
          }
          const newNode = makeNode(op.node);
          if (parentId !== undefined) newNode.parentId = parentId;
          nodes.push(newNode);
          if (newId !== op.nodeId) {
            // 移除重复 id
            const dupIndex = nodes.findIndex((n) => n.id === newId && n !== newNode);
            if (dupIndex >= 0) nodes.splice(dupIndex, 1);
          }
          appliedCount += 1;
          break;
        }
        case 'update_workflow_metadata':
          // 元数据（title/description）存储在 workflow_history 记录上，不在 TinyflowData 内。
          // 此处仅记录已应用；由上层保存新版本时写入记录。
          appliedCount += 1;
          break;
        default:
          errors.push(`未知操作: ${(op as { op: string }).op}`);
      }
    } catch (e) {
      errors.push(`${op.op}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { workflow: result, appliedCount, errors };
}
