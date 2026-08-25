/**
 * 依赖校验（Part 5 之一）
 * - 悬空引用（节点引用了不存在的上游输出）
 * - 未知执行器（节点 type 未注册）
 * - 引用的输出字段在引用的节点输出中可能存在（尽力而为）
 */

import type { TinyflowData } from '../tinyflow/types';

export interface ValidationIssue {
  level: 'error' | 'warning';
  code: string;
  nodeId?: string;
  message: string;
}

const KNOWN_EXECUTORS = new Set([
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
]);

/** 收集某节点 data 中所有 ref 引用（"nodeId.field"） */
function collectRefs(data: Record<string, unknown>): Array<{ nodeId: string; field: string }> {
  const refs: Array<{ nodeId: string; field: string }> = [];
  const walk = (obj: unknown): void => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach(walk);
      return;
    }
    const o = obj as Record<string, unknown>;
    for (const [k, v] of Object.entries(o)) {
      if (k === 'ref' && typeof v === 'string' && v.includes('.')) {
        const [nodeId, ...rest] = v.split('.');
        refs.push({ nodeId: nodeId || '', field: rest.join('.') });
      } else if (k === 'ref' && typeof v === 'string' && !v.includes('.')) {
        refs.push({ nodeId: '', field: v });
      } else {
        walk(v);
      }
    }
  };
  walk(data);
  return refs;
}

const KNOWN_OUTPUT_FIELDS: Record<string, string[]> = {
  startNode: [],
  endNode: [],
  llmNode: ['output', 'root', 'tokens'],
  httpNode: ['status', 'headers', 'body', 'statusCode'],
  codeNode: ['output'],
  knowledgeNode: ['documents'],
  searchEngineNode: ['results', 'keyword'],
  templateNode: ['output'],
  conditionNode: ['true', 'false'],
  confirmNode: ['output'],
  loopNode: ['output', 'loopCount'],
  excelNode: ['base64', 'fileName', 'sheetName', 'rowCount', 'ossKey'],
};

export function checkDependencies(flow: TinyflowData): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodeIds = new Set(flow.nodes.map((n) => n.id));

  for (const node of flow.nodes) {
    // 未知执行器
    if (!KNOWN_EXECUTORS.has(node.type)) {
      issues.push({
        level: 'error',
        code: 'unknown_executor',
        nodeId: node.id,
        message: `节点 ${node.id} 类型 "${node.type}" 未注册执行器`,
      });
    }

    // 悬空 / 未知引用的节点
    const refs = collectRefs((node.data as Record<string, unknown>) || {});
    for (const ref of refs) {
      if (ref.nodeId && !nodeIds.has(ref.nodeId)) {
        issues.push({
          level: 'error',
          code: 'dangling_ref',
          nodeId: node.id,
          message: `节点 ${node.id} 引用了不存在的节点 ${ref.nodeId}`,
        });
      } else if (ref.nodeId) {
        const target = flow.nodes.find((n) => n.id === ref.nodeId);
        const knownFields = target ? KNOWN_OUTPUT_FIELDS[target.type] : undefined;
        if (knownFields && knownFields.length > 0) {
          const root = ref.field.split('.')[0];
          if (!knownFields.includes(root)) {
            issues.push({
              level: 'warning',
              code: 'unknown_output_field',
              nodeId: node.id,
              message: `节点 ${node.id} 引用了 ${ref.nodeId}.${ref.field}，但 ${target?.type} 通常只输出 [${knownFields.join(', ')}]`,
            });
          }
        }
      }
    }
  }

  return issues;
}
