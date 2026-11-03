import type { NodeDefinition } from '../node-definition';
import { nodeRegistry } from '../node-registry';
import { fetchModelOptions } from '@/lib/ai/models-cache';

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
          // 模型列表走客户端缓存（多组件共享一次请求）
          return await fetchModelOptions();
        } catch {
          // 拉取失败返回空选项
          return [];
        }
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
      name: 'limit',
      label: '搜索数据量',
      type: 'number',
      default: 5,
      min: 1,
      max: 20,
      description: '最多返回的搜索结果条数（与画布内置面板「搜索数据量」同字段）',
    },
    {
      name: 'keyword',
      label: '搜索关键词',
      type: 'string',
      required: true,
      description: '支持 {{var}} 插值（与画布内置面板「关键字」同字段）',
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

export const EXCEL_NODE: NodeDefinition = {
  type: 'excelNode',
  label: 'Excel',
  description: '将数据生成 Excel 文件（xlsx，base64 或上传 OSS）',
  category: 'data',
  inputs: [
    {
      name: 'data',
      label: 'Data',
      dataType: 'array',
      required: true,
    },
  ],
  outputs: [
    {
      name: 'output',
      label: 'File',
      dataType: 'object',
    },
  ],
  executorType: 'excelNode',
  builtin: true,
  configSchema: [
    {
      name: 'sheetName',
      label: '工作表名',
      type: 'string',
      default: 'Sheet1',
      description: '生成的 Excel 工作表名称（最长 31 字符）',
    },
    {
      name: 'fileName',
      label: '文件名',
      type: 'string',
      default: 'data.xlsx',
      description: '输出的文件名（含 .xlsx 后缀）',
    },
    {
      name: 'outputType',
      label: '输出方式',
      type: 'select',
      default: 'base64',
      options: [
        { value: 'base64', label: 'Base64（前端直接下载）' },
        { value: 'oss', label: '上传 OSS（返回文件地址）' },
      ],
      description: 'base64 无需额外配置；oss 需要已配置存储',
    },
    {
      name: 'jsonData',
      label: '静态数据（可选）',
      type: 'json',
      description:
        '不连接上游时可直接填入对象数组，如 [{"名称":"A","数量":2}]；连接了上游数据则优先使用上游',
    },
  ],
};

// ===== Python 工具（调用独立 FastAPI 服务，不在本地执行用户代码）=====

export const PYTHON_TOOL_NODE: NodeDefinition = {
  type: 'pythonToolNode',
  label: 'Python 工具',
  description: '调用数据处理 / 文档解析工具（表格、PDF、文本清洗、字段提取）',
  category: 'data',
  inputs: [
    {
      name: 'input',
      label: 'Input',
      dataType: 'string',
      required: false,
    },
  ],
  outputs: [
    {
      name: 'output',
      label: 'Result',
      dataType: 'object',
    },
  ],
  executorType: 'pythonToolNode',
  builtin: true,
  configSchema: [
    {
      name: 'tool',
      label: '工具',
      type: 'select',
      required: true,
      options: [
        { value: 'data.analyze', label: '表格分析（summary / preview / columns）' },
        { value: 'data.transform', label: '表格清洗与转换' },
        { value: 'documents.parse', label: '文档解析（PDF / DOCX / 文本）' },
        { value: 'text.clean', label: '文本清洗' },
        { value: 'extract', label: '字段提取（邮箱 / 金额 / 日期 / 键值）' },
      ],
    },
    {
      name: 'input',
      label: '输入内容',
      type: 'textarea',
      rows: 6,
      description:
        '支持 {{节点.字段}} 插值。二进制文档（PDF/DOCX）请改在参数里传 content_base64。',
    },
    {
      name: 'params',
      label: '参数（JSON）',
      type: 'json',
      description: '如 {"operation":"summary","preview_rows":5}；同样支持插值。',
    },
    {
      name: 'timeoutMs',
      label: '超时（毫秒）',
      type: 'number',
      default: 25000,
      min: 1000,
      max: 60000,
    },
  ],
};

// ===== Agent（受控多轮工具调用）=====

export const AGENT_NODE: NodeDefinition = {
  type: 'agentNode',
  label: 'Agent',
  description: '根据目标动态调用 MCP 工具，受步数 / Token / 超时 / 权限约束',
  category: 'ai',
  inputs: [
    {
      name: 'goal',
      label: 'Goal',
      dataType: 'string',
      required: true,
    },
  ],
  outputs: [
    {
      name: 'output',
      label: 'Answer',
      dataType: 'string',
    },
    {
      name: 'steps',
      label: 'Steps',
      dataType: 'object',
    },
  ],
  capabilities: ['text', 'tool'],
  executorType: 'agentNode',
  builtin: true,
  configSchema: [
    {
      name: 'goal',
      label: '目标',
      type: 'textarea',
      required: true,
      rows: 4,
      description: '支持 {{节点.字段}} 插值。Agent 会围绕该目标决定是否继续调用工具。',
    },
    {
      name: 'llmId',
      label: '模型',
      type: 'select',
      required: true,
      optionsProvider: async () => {
        try {
          return await fetchModelOptions();
        } catch {
          return [];
        }
      },
    },
    {
      name: 'mcpServerId',
      label: 'MCP Server',
      type: 'string',
      required: true,
      placeholder: 'MCP Server ID',
      description: '来自 MCP 配置；Agent 只能调用该 Server 下已发现的工具。',
    },
    {
      name: 'systemPrompt',
      label: '系统提示词',
      type: 'textarea',
      rows: 3,
    },
    {
      name: 'allowedScope',
      label: '自动执行权限',
      type: 'select',
      default: 'read',
      options: [
        { value: 'read', label: '只读（写操作需审批）' },
        { value: 'write', label: '读写' },
        { value: 'dangerous', label: '危险操作（不建议）' },
      ],
    },
    {
      name: 'approvedTools',
      label: '已审批工具',
      type: 'string',
      placeholder: 'write_doc, delete_doc',
      description: '逗号分隔。列出的工具可绕过权限上限自动执行。',
    },
    {
      name: 'maxSteps',
      label: '最大步数',
      type: 'number',
      default: 6,
      min: 1,
      max: 20,
    },
    {
      name: 'tokenBudget',
      label: 'Token 预算',
      type: 'number',
      default: 20000,
      min: 1000,
      max: 200000,
    },
    {
      name: 'timeoutMs',
      label: '总超时（毫秒）',
      type: 'number',
      default: 120000,
      min: 5000,
      max: 600000,
    },
  ],
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
nodeRegistry.register(EXCEL_NODE);
nodeRegistry.register(PYTHON_TOOL_NODE);
nodeRegistry.register(AGENT_NODE);

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
