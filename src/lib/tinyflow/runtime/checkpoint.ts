import type { FlowContext, NodeStatus } from '../types';

/**
 * 通用执行 checkpoint：把「内存态 FlowContext」序列化为可落库/可恢复的纯数据。
 * 支持：服务重启 / 进程异常 / API 中断 / 用户稍后恢复 / Human Confirm。
 */
export interface CheckpointData {
  flowId: string;
  workflowVersion: number;
  state: string;
  inputs: Record<string, unknown>;
  nodeOutputs: Record<string, Record<string, unknown>>;
  nodeStatuses: Record<string, string>;
  variables: Record<string, unknown>;
  userId?: string | null;
  startedAt: number;
  /** 已完成的节点（恢复时跳过，防止重复执行） */
  executedNodes: string[];
  /** 就绪但未执行的节点（恢复执行位置） */
  readyNodes: string[];
  /** 最后完成节点的时间戳（续跑超时预算用） */
  lastUpdatedAt: number;
}

export interface ContextSnapshot {
  nodeOutputs: Record<string, Record<string, unknown>>;
  nodeStatuses: Record<string, string>;
  variables: Record<string, unknown>;
}

function mapToRecord<K extends string, V>(map: Map<K, V>): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [k, v] of map) out[k] = v;
  return out;
}

function recordToMap<K extends string, V>(record: Record<string, V>): Map<K, V> {
  const map = new Map<K, V>();
  for (const k of Object.keys(record)) map.set(k as K, record[k]);
  return map;
}

/** 捕获当前上下文快照（含 executed/ready，供 checkpoint） */
export function captureContext(
  context: FlowContext,
  extra: { executedNodes: string[]; readyNodes: string[]; startedAt: number },
): CheckpointData {
  return {
    flowId: context.flowId,
    workflowVersion: 1,
    state: 'running',
    inputs: context.inputs,
    nodeOutputs: mapToRecord(context.nodeOutputs),
    nodeStatuses: mapToRecord(context.nodeStatuses),
    variables: mapToRecord(context.variables),
    userId: context.userId ?? null,
    startedAt: extra.startedAt,
    executedNodes: [...extra.executedNodes],
    readyNodes: [...extra.readyNodes],
    lastUpdatedAt: Date.now(),
  };
}

/** 序列化为可落库 JSON */
export function serializeCheckpoint(checkpoint: CheckpointData): Record<string, unknown> {
  return checkpoint as unknown as Record<string, unknown>;
}

/** 从 JSON 恢复 CheckpointData（容错缺失字段） */
export function deserializeCheckpoint(raw: unknown): CheckpointData | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Partial<CheckpointData>;
  if (!data.flowId || !data.nodeOutputs || !data.nodeStatuses) return null;
  return {
    flowId: data.flowId,
    workflowVersion: data.workflowVersion ?? 1,
    state: data.state ?? 'running',
    inputs: data.inputs ?? {},
    nodeOutputs: data.nodeOutputs ?? {},
    nodeStatuses: data.nodeStatuses ?? {},
    variables: data.variables ?? {},
    userId: data.userId ?? null,
    startedAt: data.startedAt ?? Date.now(),
    executedNodes: data.executedNodes ?? [],
    readyNodes: data.readyNodes ?? [],
    lastUpdatedAt: data.lastUpdatedAt ?? Date.now(),
  };
}

/** 从 CheckpointData 恢复内存态 FlowContext（仅恢复纯数据；signal 等运行时字段由调用方补齐） */
export function restoreContext(checkpoint: CheckpointData): FlowContext {
  return {
    flowId: checkpoint.flowId,
    inputs: { ...checkpoint.inputs },
    nodeOutputs: recordToMap(checkpoint.nodeOutputs),
    nodeStatuses: recordToMap(checkpoint.nodeStatuses as Record<string, NodeStatus>),
    variables: recordToMap(checkpoint.variables),
    userId: checkpoint.userId ?? null,
  };
}
