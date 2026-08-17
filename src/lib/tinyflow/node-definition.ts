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
  /** 端口默认值（模板插值场景） */
  defaultValue?: unknown;
}

// ===== 节点配置表单字段（Canvas 属性面板驱动）=====
// 声明式描述「一个配置项长什么样」——自定义节点无需改前端代码即可获得配置表单。
// 字段 name 对应 NodeData[name]（画布保存的节点配置）。
export type NodeConfigFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'select'
  | 'textarea'
  | 'json'
  | 'code';

export interface NodeConfigField {
  /** 字段名（对应 NodeData 的 key） */
  name: string;
  label: string;
  type: NodeConfigFieldType;
  required?: boolean;
  /** 默认值 */
  default?: unknown;
  placeholder?: string;
  description?: string;
  /** select 选项 */
  options?: Array<{ value: string; label: string }>;
  /** 动态选项提供者（如模型列表；/api/nodes 返回前 resolve 为静态 options） */
  optionsProvider?: () =>
    | Array<{ value: string; label: string }>
    | Promise<Array<{ value: string; label: string }>>;
  /** number 范围 */
  min?: number;
  max?: number;
  /** textarea 行数 */
  rows?: number;
}

// ===== 节点配置序列化钩子（插件可选实现）=====
// 默认原样存取；插件可自定义节点配置在数据库中的存储形式。
export interface NodeSerializer {
  /** 保存前：节点 data → 持久化形式 */
  serialize?: (data: Record<string, unknown>) => Record<string, unknown>;
  /** 加载后：持久化形式 → 节点 data */
  deserialize?: (data: Record<string, unknown>) => Record<string, unknown>;
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

  /** 配置表单 schema（属性面板驱动）；缺省时用 NodeData 泛化字段渲染 */
  configSchema?: NodeConfigField[];

  /** 节点来源：builtin=代码内置 / custom=数据库注册（Plugin SDK 预留） */
  source?: 'builtin' | 'custom';

  /** 节点定义版本（默认 1；未来按版本做兼容迁移的依据） */
  version?: number;

  /** 配置序列化钩子（插件可选实现；默认原样存取） */
  serializer?: NodeSerializer;
}
