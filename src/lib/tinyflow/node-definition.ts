import type { ModelCapability } from '@/lib/ai';

// ===== NodeDefinition：描述"一个节点类型是什么" =====
// 与 NodeData（节点实例的保存配置）严格区分：
//   NodeDefinition = 节点类型本身（叫什么/分类/输入输出/能力）
//   NodeData       = 画布上某个具体节点实例的当前配置

export type NodeCategory =
  | 'core' // 核心（开始/结束/确认）
  | 'ai' // AI（LLM/知识库/搜索）
  | 'integration' // 集成（HTTP）
  | 'logic' // 逻辑（代码/循环）
  | 'data' // 数据（模板）
  | 'custom'; // 自定义（预留）

export interface NodePortDefinition {
  name: string;
  label: string;
  dataType: string;
  required?: boolean;
  description?: string;
}

export interface NodeDefinition {
  /** 节点类型标识（对应画布 node.type） */
  type: string;
  /** 显示名 */
  label: string;
  /** 描述 */
  description: string;
  /** 分类 */
  category: NodeCategory;

  icon?: string;

  /** 输入端口 */
  inputs: NodePortDefinition[];
  /** 输出端口 */
  outputs: NodePortDefinition[];

  /** 节点能力（如 LLM 支持 text/vision） */
  capabilities?: ModelCapability[];

  /** 对应执行器类型（默认与 type 相同） */
  executorType: string;

  /** 是否为内置节点 */
  builtin?: boolean;
}
