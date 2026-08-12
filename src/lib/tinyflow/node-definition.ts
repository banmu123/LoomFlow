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

// ===== 内置节点定义 =====
// 基于现有 10 种 Executor 的 NodeData 结构推导

export const NODE_DEFINITIONS: NodeDefinition[] = [
  {
    type: 'startNode',
    label: '开始',
    description: '定义工作流的输入参数',
    category: 'core',
    inputs: [],
    outputs: [{ name: 'parameters', label: '输入参数', dataType: 'object' }],
    executorType: 'startNode',
    builtin: true,
  },
  {
    type: 'endNode',
    label: '结束',
    description: '汇总并输出工作流结果',
    category: 'core',
    inputs: [{ name: 'parameters', label: '输出参数', dataType: 'object' }],
    outputs: [],
    executorType: 'endNode',
    builtin: true,
  },
  {
    type: 'llmNode',
    label: '大模型',
    description: '调用大语言模型生成回复',
    category: 'ai',
    inputs: [
      { name: 'userPrompt', label: '用户提示词', dataType: 'string', required: true },
      { name: 'images', label: '图片', dataType: 'array' },
      { name: 'systemPrompt', label: '系统提示词', dataType: 'string' },
    ],
    outputs: [{ name: 'output', label: '输出', dataType: 'string' }],
    capabilities: ['text', 'vision'], // vision 能力取决于所选模型
    executorType: 'llmNode',
    builtin: true,
  },
  {
    type: 'httpNode',
    label: 'HTTP 请求',
    description: '发送 HTTP 请求并获取响应',
    category: 'integration',
    inputs: [
      { name: 'url', label: '请求地址', dataType: 'string', required: true },
      { name: 'method', label: '请求方法', dataType: 'string' },
      { name: 'headers', label: '请求头', dataType: 'object' },
      { name: 'body', label: '请求体', dataType: 'object' },
    ],
    outputs: [
      { name: 'statusCode', label: '状态码', dataType: 'number' },
      { name: 'headers', label: '响应头', dataType: 'object' },
      { name: 'body', label: '响应体', dataType: 'object' },
    ],
    executorType: 'httpNode',
    builtin: true,
  },
  {
    type: 'codeNode',
    label: '代码',
    description: '在沙箱中执行自定义代码',
    category: 'logic',
    inputs: [{ name: 'parameters', label: '输入参数', dataType: 'object' }],
    outputs: [{ name: 'outputDefs', label: '输出', dataType: 'object' }],
    executorType: 'codeNode',
    builtin: true,
  },
  {
    type: 'knowledgeNode',
    label: '知识库',
    description: '从知识库检索信息',
    category: 'ai',
    inputs: [
      { name: 'keyword', label: '关键词', dataType: 'string', required: true },
      { name: 'knowledgeId', label: '知识库', dataType: 'string' },
    ],
    outputs: [{ name: 'result', label: '检索结果', dataType: 'object' }],
    executorType: 'knowledgeNode',
    builtin: true,
  },
  {
    type: 'searchEngineNode',
    label: '搜索引擎',
    description: '执行网络搜索',
    category: 'ai',
    inputs: [
      { name: 'keyword', label: '关键词', dataType: 'string', required: true },
      { name: 'limit', label: '结果数量', dataType: 'number' },
    ],
    outputs: [{ name: 'result', label: '搜索结果', dataType: 'object' }],
    executorType: 'searchEngineNode',
    builtin: true,
  },
  {
    type: 'templateNode',
    label: '模板',
    description: '使用模板渲染文本',
    category: 'data',
    inputs: [
      { name: 'template', label: '模板', dataType: 'string', required: true },
      { name: 'parameters', label: '参数', dataType: 'object' },
    ],
    outputs: [{ name: 'output', label: '输出', dataType: 'string' }],
    executorType: 'templateNode',
    builtin: true,
  },
  {
    type: 'confirmNode',
    label: '人工确认',
    description: '暂停流程等待人工确认',
    category: 'core',
    inputs: [
      { name: 'message', label: '确认信息', dataType: 'string', required: true },
      { name: 'confirms', label: '确认字段', dataType: 'array' },
    ],
    outputs: [{ name: 'confirms', label: '确认结果', dataType: 'object' }],
    executorType: 'confirmNode',
    builtin: true,
  },
  {
    type: 'loopNode',
    label: '循环',
    description: '对集合执行循环处理',
    category: 'logic',
    inputs: [{ name: 'loopVars', label: '循环变量', dataType: 'array' }],
    outputs: [{ name: 'loopItem', label: '循环项', dataType: 'object' }],
    executorType: 'loopNode',
    builtin: true,
  },
];

// ===== 便捷查询 =====
const definitionMap = new Map(NODE_DEFINITIONS.map((d) => [d.type, d]));

export function getNodeDefinition(type: string): NodeDefinition | undefined {
  return definitionMap.get(type);
}

export function getNodeDefinitionsByCategory(category: NodeCategory): NodeDefinition[] {
  return NODE_DEFINITIONS.filter((d) => d.category === category);
}
