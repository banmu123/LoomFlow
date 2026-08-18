import { supabase } from '@/lib/supabase/server';
import { nodeRegistry } from './node-registry';
import { ExecutorRegistry } from './executors';
import type { NodeDefinition, NodeConfigField, NodePortDefinition } from './node-definition';

// ===== 自定义节点库（Phase 5）=====
// 自定义节点持久化到 node_definitions 表，加载时合并进现有 NodeRegistry——
// 不维护第二套注册表，引擎/校验/节点库面板统一走 registry。
// 官方节点 source: 'official'（只读）；自定义节点 source: 'custom'（可编辑）。

export interface CustomNodeRecord {
  id: string;
  type: string;
  label: string;
  description: string | null;
  category: string;
  icon: string | null;
  inputs: NodePortDefinition[];
  outputs: NodePortDefinition[];
  config_schema: NodeConfigField[];
  capabilities: string[];
  version: number;
  status: string;
  user_id: string | null;
  /** 复用内置执行器：空/等于自身 type = 未绑定；指定内置节点 type（如 templateNode）= 复用其执行逻辑 */
  executor_type?: string | null;
  created_at: string;
  updated_at: string;
}

/** DB 记录 → NodeDefinition（注册进 registry 的形态） */
function recordToDefinition(rec: CustomNodeRecord): NodeDefinition {
  return {
    type: rec.type,
    label: rec.label,
    description: rec.description ?? '',
    category: (rec.category as NodeDefinition['category']) || 'custom',
    icon: rec.icon ?? undefined,
    inputs: Array.isArray(rec.inputs) ? rec.inputs : [],
    outputs: Array.isArray(rec.outputs) ? rec.outputs : [],
    configSchema: Array.isArray(rec.config_schema) ? rec.config_schema : [],
    capabilities: (rec.capabilities as NodeDefinition['capabilities']) ?? ['text'],
    executorType: rec.executor_type || rec.type,
    builtin: false,
    source: 'custom',
    version: rec.version ?? 1,
  };
}

/** 加载某用户的自定义节点并注册进 registry（幂等：先注销同 type 再注册）+ 恢复执行器绑定 */
export async function loadCustomNodesForUser(userId: string): Promise<void> {
  const { data } = await supabase
    .from('node_definitions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active');

  for (const rec of data ?? []) {
    const r = rec as unknown as CustomNodeRecord;
    nodeRegistry.register(recordToDefinition(r));
    // 重启后恢复 executorType 绑定（否则自定义节点执行报「未注册执行器」）
    bindExecutor(recordToDefinition(r));
  }
}

/** 查询用户的自定义节点定义（列表） */
export async function listCustomNodes(userId: string): Promise<NodeDefinition[]> {
  const { data } = await supabase
    .from('node_definitions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  return (data ?? []).map((r: unknown) => recordToDefinition(r as CustomNodeRecord));
}

/** 创建自定义节点（type 需校验：不与官方节点及该用户已有节点冲突） */
export async function createCustomNode(
  userId: string,
  def: NodeDefinition,
): Promise<{ error?: string; node?: NodeDefinition }> {
  if (!def.type || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(def.type)) {
    return { error: '节点类型必须为字母开头，仅含字母/数字/_-' };
  }
  // 与官方节点冲突检查
  if (nodeRegistry.get(def.type)) {
    return { error: `节点类型 ${def.type} 已存在` };
  }

  const { data, error } = await supabase
    .from('node_definitions')
    .insert({
      type: def.type,
      label: def.label,
      description: def.description ?? '',
      category: def.category ?? 'custom',
      icon: def.icon ?? null,
      inputs: def.inputs ?? [],
      outputs: def.outputs ?? [],
      config_schema: def.configSchema ?? [],
      capabilities: def.capabilities ?? ['text'],
      version: def.version ?? 1,
      executor_type: def.executorType && def.executorType !== def.type ? def.executorType : null,
      user_id: userId,
    })
    .select()
    .single();

  if (error || !data) {
    return { error: error?.message || '创建失败' };
  }

  const node = recordToDefinition(data as unknown as CustomNodeRecord);
  nodeRegistry.register(node);
  // 路径 A：指定 executorType 时复用内置执行器（自定义节点可真正执行）
  // 例如 executorType='templateNode' → 画布执行走模板渲染逻辑
  bindExecutor(node);
  return { node };
}

/**
 * 将自定义节点绑定执行器：
 * - 未指定 executorType（= type）：不绑定（执行时报「未注册执行器」）
 * - 指定了已注册的 executorType：把内置执行器注册到本节点 type 名下
 *   （如 executorType='templateNode' → 画布执行走模板渲染逻辑）
 */
function bindExecutor(def: NodeDefinition): void {
  const executorType = def.executorType ?? def.type;
  if (!executorType || executorType === def.type) return; // 默认 = type：未实现执行器，跳过
  const Ctor = ExecutorRegistry.get(executorType);
  if (Ctor) {
    ExecutorRegistry.register(def.type, Ctor);
  }
}

/** 更新自定义节点（仅本人；type 不可改——改类型需删除重建） */
export async function updateCustomNode(
  userId: string,
  id: string,
  def: Partial<NodeDefinition>,
): Promise<{ error?: string; node?: NodeDefinition }> {
  const patch: Record<string, unknown> = {};
  if (def.label !== undefined) patch.label = def.label;
  if (def.description !== undefined) patch.description = def.description;
  if (def.category !== undefined) patch.category = def.category;
  if (def.icon !== undefined) patch.icon = def.icon;
  if (def.inputs !== undefined) patch.inputs = def.inputs;
  if (def.outputs !== undefined) patch.outputs = def.outputs;
  if (def.configSchema !== undefined) patch.config_schema = def.configSchema;
  if (def.capabilities !== undefined) patch.capabilities = def.capabilities;
  if (def.version !== undefined) patch.version = def.version;
  // executorType 变更：清空（null）或复用内置执行器（≠ type 时落库；= type 视为清空）
  if (def.executorType !== undefined) {
    patch.executor_type =
      def.executorType && def.executorType !== def.type ? def.executorType : null;
  }
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('node_definitions')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error || !data) {
    return { error: error?.message || '更新失败' };
  }

  const node = recordToDefinition(data as unknown as CustomNodeRecord);
  // 重新注册（覆盖旧定义）+ 重新绑定执行器
  nodeRegistry.register(node);
  bindExecutor(node);
  return { node };
}

/** 删除自定义节点（仅本人；同步从 registry 注销） */
export async function deleteCustomNode(
  userId: string,
  id: string,
  nodeType?: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('node_definitions')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) return { error: error.message };
  if (nodeType) nodeRegistry.unregister(nodeType);
  return {};
}

/** 复制自定义节点（type 加后缀避免冲突） */
export async function duplicateCustomNode(
  userId: string,
  source: NodeDefinition,
): Promise<{ error?: string; node?: NodeDefinition }> {
  const type = `${source.type}_copy`;
  const copy: NodeDefinition = {
    ...source,
    type,
    label: `${source.label}（副本）`,
    source: 'custom',
  };
  return createCustomNode(userId, copy);
}
