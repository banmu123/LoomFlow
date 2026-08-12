import type { NodeDefinition } from '../node-definition';
import { nodeRegistry } from '../node-registry';
import { ExecutorRegistry } from '../executors';

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
};

export const HTTP_NODE: NodeDefinition = {
  type: 'httpNode',
  label: 'HTTP',
  description: '发送 HTTP 请求',
  category: 'integration',
  inputs: [
    {
      name: 'url',
      label: 'URL',
      dataType: 'string',
      required: true,
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
  description: '执行网络搜索',
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
};

export const TEMPLATE_NODE: NodeDefinition = {
  type: 'templateNode',
  label: '模板',
  description: '使用模板渲染文本',
  category: 'data',
  inputs: [
    {
      name: 'template',
      label: 'Template',
      dataType: 'string',
      required: true,
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
nodeRegistry.register(CONFIRM_NODE);
nodeRegistry.register(LOOP_NODE);

// ===== 一致性校验：executorType 必须可执行（防幽灵节点） =====
for (const def of nodeRegistry.list()) {
  if (!ExecutorRegistry.get(def.executorType)) {
    throw new Error(
      `节点 ${def.type} 的 executorType（${def.executorType}）未注册执行器，请先在 ExecutorRegistry 注册`,
    );
  }
}
