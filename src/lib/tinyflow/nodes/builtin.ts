import type { NodeDefinition } from '../node-definition';
import { nodeRegistry } from '../node-registry';

// ===== 内置节点注册（最小定义，与 NodeData 保持分离） =====

export const START_NODE: NodeDefinition = {
  type: 'startNode',
  label: '开始',
  description: '工作流开始节点',
  category: 'core',
  inputs: [],
  outputs: [
    {
      name: 'output',
      label: 'Output',
      dataType: 'object',
    },
  ],
  executorType: 'startNode',
  builtin: true,
};

export const END_NODE: NodeDefinition = {
  type: 'endNode',
  label: '结束',
  description: '工作流结束节点',
  category: 'core',
  inputs: [
    {
      name: 'input',
      label: 'Input',
      dataType: 'object',
    },
  ],
  outputs: [],
  executorType: 'endNode',
  builtin: true,
};

export const LLM_NODE: NodeDefinition = {
  type: 'llmNode',
  label: 'LLM',
  description: '调用大语言模型生成文本或多模态结果',
  category: 'ai',

  inputs: [
    {
      name: 'prompt',
      label: 'Prompt',
      dataType: 'string',
      required: true,
    },
    {
      name: 'images',
      label: 'Images',
      dataType: 'image[]',
    },
    {
      name: 'variables',
      label: 'Variables',
      dataType: 'object',
      description: '模板插值变量（prompt 中的 {{var}} 会替换）',
    },
  ],

  outputs: [
    {
      name: 'output',
      label: 'Output',
      dataType: 'string',
    },
  ],

  capabilities: ['text', 'vision'],

  executorType: 'llmNode',
  builtin: true,
  configSchema: [
    {
      name: 'llmId',
      label: '模型',
      type: 'select',
      required: true,
      description: '选择已配置的模型（管理后台 → 模型配置）',
      // 动态选项：/api/nodes 返回前 resolve 为静态 options（前端可直接渲染）
      optionsProvider: async () => {
        try {
          const res = await fetch('/api/ai/models');
          const data = await res.json();
          if (Array.isArray(data)) {
            return data.map((m: { id: string; label: string | null }) => ({
              value: m.id,
              label: m.label || m.id,
            }));
          }
        } catch {
          // 拉取失败返回空选项
        }
        return [];
      },
    },
    {
      name: 'systemPrompt',
      label: '系统提示词',
      type: 'textarea',
      rows: 4,
      description: '系统角色设定（支持 {{var}} 插值）',
    },
    {
      name: 'temperature',
      label: '温度',
      type: 'number',
      default: 0.7,
      min: 0,
      max: 2,
      description: '采样温度，越高越随机',
    },
    {
      name: 'maxTokens',
      label: '最大输出长度',
      type: 'number',
      default: 8192,
      min: 1,
      description: '生成的最大 token 数',
    },
    {
      name: 'outType',
      label: '输出格式',
      type: 'select',
      default: 'text',
      options: [
        { value: 'text', label: '文本' },
        { value: 'json', label: 'JSON' },
      ],
    },
  ],
};

export const HTTP_NODE: NodeDefinition = {
  type: 'httpNode',
  label: 'HTTP',
  description: '发送 HTTP 请求（SSRF 防护：仅公网 http/https）',
  category: 'integration',
  inputs: [
    {
      name: 'url',
      label: 'URL',
      dataType: 'string',
      required: true,
    },
    {
      name: 'variables',
      label: 'Variables',
      dataType: 'object',
      description: 'URL/Headers/Body 中的 {{var}} 插值变量',
    },
  ],
  outputs: [
    {
      name: 'output',
      label: 'Response',
      dataType: 'object',
    },
  ],
  executorType: 'httpNode',
  builtin: true,
  configSchema: [
    {
      name: 'method',
      label: '请求方法',
      type: 'select',
      default: 'GET',
      options: [
        { value: 'GET', label: 'GET' },
        { value: 'POST', label: 'POST' },
        { value: 'PUT', label: 'PUT' },
        { value: 'PATCH', label: 'PATCH' },
        { value: 'DELETE', label: 'DELETE' },
      ],
    },
    {
      name: 'url',
      label: 'URL',
      type: 'string',
      required: true,
      placeholder: 'https://api.example.com/v1（仅公网地址）',
      description: '支持 {{var}} 插值',
    },
    {
      name: 'headers',
      label: '请求头',
      type: 'json',
      description: '键值对，如 {"Authorization": "Bearer xxx"}',
    },
    {
      name: 'bodyType',
      label: '请求体类型',
      type: 'select',
      default: 'json',
      options: [
        { value: 'json', label: 'JSON' },
        { value: 'raw', label: 'Raw 文本' },
        { value: 'form-data', label: 'Form Data' },
        { value: 'form-urlencoded', label: 'URL 编码' },
      ],
    },
    {
      name: 'bodyJson',
      label: 'JSON 请求体',
      type: 'json',
      description: '支持 {{var}} 插值',
    },
    {
      name: 'timeout',
      label: '超时（秒）',
      type: 'number',
      default: 10,
      min: 1,
      max: 60,
      description: '请求超时时间',
    },
  ],
};

export const CODE_NODE: NodeDefinition = {
  type: 'codeNode',
  label: '代码',
  description: '执行代码逻辑',
  category: 'logic',
  inputs: [
    {
      name: 'input',
      label: 'Input',
      dataType: 'object',
    },
  ],
  outputs: [
    {
      name: 'output',
      label: 'Output',
      dataType: 'object',
    },
  ],
  executorType: 'codeNode',
  builtin: true,
};

export const KNOWLEDGE_NODE: NodeDefinition = {
  type: 'knowledgeNode',
  label: '知识库',
  description: '从知识库检索信息',
  category: 'ai',
  inputs: [
    {
      name: 'keyword',
      label: 'Keyword',
      dataType: 'string',
      required: true,
    },
  ],
  outputs: [
    {
      name: 'output',
      label: 'Result',
      dataType: 'object',
    },
  ],
  executorType: 'knowledgeNode',
  builtin: true,
};

export const SEARCH_ENGINE_NODE: NodeDefinition = {
  type: 'searchEngineNode',
  label: '搜索',
  description: '执行网络搜索（通过已配置的搜索服务）',
  category: 'ai',
  inputs: [
    {
      name: 'keyword',
      label: 'Keyword',
      dataType: 'string',
      required: true,
    },
  ],
  outputs: [
    {
      name: 'output',
      label: 'Result',
      dataType: 'object',
    },
  ],
  executorType: 'searchEngineNode',
  builtin: true,
  configSchema: [
    {
      name: 'engine',
      label: '搜索服务',
      type: 'select',
      required: true,
      description: '选择已启用的搜索服务（管理后台 → 搜索配置）',
      // 动态选项：服务端直接查 DB（与 LLM 节点 optionsProvider 同模式，但走直连避免相对路径 fetch）
      optionsProvider: async () => {
        const { getEnabledSearchProviders } = await import('@/lib/search/db-providers');
        const providers = await getEnabledSearchProviders();
        return providers.map((p) => ({ value: p.id, label: p.label || p.id }));
      },
    },
    {
      name: 'maxResults',
      label: '返回数量',
      type: 'number',
      default: 5,
      min: 1,
      max: 20,
      description: '最多返回的搜索结果条数',
    },
    {
      name: 'query',
      label: '搜索关键词',
      type: 'string',
      required: true,
      description: '支持 {{var}} 插值',
    },
  ],
};

export const TEMPLATE_NODE: NodeDefinition = {
  type: 'templateNode',
  label: '提示词模板',
  description: '使用模板渲染文本（{{var}} 变量替换）',
  category: 'ai',
  inputs: [
    {
      name: 'template',
      label: 'Template',
      dataType: 'string',
      required: true,
    },
    {
      name: 'variables',
      label: 'Variables',
      dataType: 'object',
      description: '模板中的 {{var}} 插值变量',
    },
  ],
  outputs: [
    {
      name: 'output',
      label: 'Output',
      dataType: 'string',
    },
  ],
  executorType: 'templateNode',
  builtin: true,
  configSchema: [
    {
      name: 'template',
      label: '模板内容',
      type: 'textarea',
      rows: 8,
      required: true,
      placeholder: '你是一个客服助手。\n\n用户问题：{{question}}\n\n请生成回复。',
      description: '{{变量}} 会在运行时替换',
    },
  ],
};

// ===== 条件节点（逻辑分支）=====
export const CONDITION_NODE: NodeDefinition = {
  type: 'conditionNode',
  label: '条件',
  description: '根据条件表达式决定流程分支（true / false 两个输出）',
  category: 'logic',
  inputs: [
    {
      name: 'input',
      label: '输入',
      dataType: 'object',
      description: '参与判断的数据',
    },
  ],
  outputs: [
    {
      name: 'true',
      label: 'True',
      dataType: 'boolean',
    },
    {
      name: 'false',
      label: 'False',
      dataType: 'boolean',
    },
  ],
  executorType: 'conditionNode',
  builtin: true,
  configSchema: [
    {
      name: 'condition',
      label: '条件表达式',
      type: 'textarea',
      rows: 2,
      required: true,
      placeholder: '{{score}} > 80',
      description:
        '支持 {{input.字段}} 插值 + 比较运算符：== != > >= < <= contains startsWith endsWith',
    },
  ],
};

export const CONFIRM_NODE: NodeDefinition = {
  type: 'confirmNode',
  label: '人工确认',
  description: '暂停流程等待人工确认',
  category: 'core',
  inputs: [
    {
      name: 'message',
      label: 'Message',
      dataType: 'string',
      required: true,
    },
  ],
  outputs: [
    {
      name: 'output',
      label: 'Confirm Result',
      dataType: 'object',
    },
  ],
  executorType: 'confirmNode',
  builtin: true,
};

export const LOOP_NODE: NodeDefinition = {
  type: 'loopNode',
  label: '循环',
  description: '对集合执行循环处理',
  category: 'logic',
  inputs: [
    {
      name: 'input',
      label: 'Collection',
      dataType: 'array',
    },
  ],
  outputs: [
    {
      name: 'item',
      label: 'Loop Item',
      dataType: 'object',
    },
  ],
  executorType: 'loopNode',
  builtin: true,
};

// ===== 统一注册 =====

nodeRegistry.register(START_NODE);
nodeRegistry.register(END_NODE);
nodeRegistry.register(LLM_NODE);
nodeRegistry.register(HTTP_NODE);
nodeRegistry.register(CODE_NODE);
nodeRegistry.register(KNOWLEDGE_NODE);
nodeRegistry.register(SEARCH_ENGINE_NODE);
nodeRegistry.register(TEMPLATE_NODE);
nodeRegistry.register(CONDITION_NODE);
nodeRegistry.register(CONFIRM_NODE);
nodeRegistry.register(LOOP_NODE);

// ===== 一致性校验（运行时动态执行，避免静态打包 coze SDK） =====
// 校验每个节点的 executorType 在 ExecutorRegistry 中存在（防幽灵节点）
export async function validateNodeRegistry(): Promise<string[]> {
  const { ExecutorRegistry } = await import('../executors');
  const missing: string[] = [];
  for (const def of nodeRegistry.list()) {
    if (!ExecutorRegistry.get(def.executorType)) {
      missing.push(
        `节点 ${def.type} 的 executorType（${def.executorType}）未注册执行器，请先在 ExecutorRegistry 注册`,
      );
    }
  }
  return missing;
}
