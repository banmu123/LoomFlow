// ===== 工作流模板 =====
// 内置示例工作流：新用户一键加载到画布，快速上手
// 模板中的 llmId 使用常见默认值，加载时由 normalizeWorkflowModels 替换为用户配置的模型
// 模板数据使用宽松结构：只填画布需要的字段（缺省字段由画布/执行器按默认值处理）

export interface WorkflowTemplateData {
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    data: Record<string, unknown>;
  }>;
  edges: Array<{ id: string; source: string; target: string }>;
  viewport: { x: number; y: number; zoom: number };
}

export interface WorkflowTemplate {
  id: string;
  title: string;
  description: string;
  tags: string[];
  emoji: string;
  data: WorkflowTemplateData;
}

const viewport = { x: 250, y: 100, zoom: 1 };

// 模板 1：产品卖点文案生成
const productCopyTemplate: WorkflowTemplateData = {
  nodes: [
    {
      id: 'node_start',
      type: 'startNode',
      position: { x: 50, y: 200 },
      data: {
        title: '开始',
        description: '输入产品名',
        expand: true,
        parameters: [
          {
            id: 'p1',
            name: 'product',
            dataType: 'String',
            refType: 'input',
            required: true,
            defaultValue: '',
          },
        ],
      },
    },
    {
      id: 'node_llm',
      type: 'llmNode',
      position: { x: 400, y: 200 },
      data: {
        title: '生成卖点文案',
        description: '调用大模型生成产品卖点',
        expand: true,
        llmId: 'deepseek-v4-flash',
        systemPrompt: '你是一位资深营销文案专家，擅长用简洁有力的语言提炼产品卖点。',
        userPrompt: '请为产品「{{product}}」生成 5 条简洁有力的卖点文案，每条不超过 30 字。',
        temperature: 0.7,
        outType: 'text',
        parameters: [
          { id: 'lp1', name: 'product', refType: 'ref', ref: 'node_start.product' },
        ],
        outputDefs: [{ id: 'lo1', name: 'output', dataType: 'String' }],
      },
    },
    {
      id: 'node_end',
      type: 'endNode',
      position: { x: 800, y: 200 },
      data: {
        title: '结束',
        description: '返回文案结果',
        expand: true,
        outputDefs: [
          { id: 'o1', name: 'result', refType: 'ref', ref: 'node_llm.output' },
        ],
      },
    },
  ],
  edges: [
    { id: 'e1', source: 'node_start', target: 'node_llm' },
    { id: 'e2', source: 'node_llm', target: 'node_end' },
  ],
  viewport,
};

// 模板 2：短视频脚本生成
const videoScriptTemplate: WorkflowTemplateData = {
  nodes: [
    {
      id: 'node_start',
      type: 'startNode',
      position: { x: 50, y: 200 },
      data: {
        title: '开始',
        description: '输入视频主题',
        expand: true,
        parameters: [
          {
            id: 'p1',
            name: 'topic',
            dataType: 'String',
            refType: 'input',
            required: true,
            defaultValue: '',
          },
        ],
      },
    },
    {
      id: 'node_llm',
      type: 'llmNode',
      position: { x: 400, y: 200 },
      data: {
        title: '生成视频脚本',
        description: '调用大模型生成口播脚本',
        expand: true,
        llmId: 'deepseek-v4-flash',
        systemPrompt: '你是一位短视频脚本专家，熟悉爆款视频的结构与节奏。',
        userPrompt:
          '请为「{{topic}}」生成一个 60 秒口播视频脚本，包含：开场钩子（3 秒抓住注意力）、主体内容（分 3 点展开）、结尾引导（引导关注或评论）。',
        temperature: 0.8,
        outType: 'text',
        parameters: [
          { id: 'lp1', name: 'topic', refType: 'ref', ref: 'node_start.topic' },
        ],
        outputDefs: [{ id: 'lo1', name: 'output', dataType: 'String' }],
      },
    },
    {
      id: 'node_end',
      type: 'endNode',
      position: { x: 800, y: 200 },
      data: {
        title: '结束',
        description: '返回脚本结果',
        expand: true,
        outputDefs: [
          { id: 'o1', name: 'result', refType: 'ref', ref: 'node_llm.output' },
        ],
      },
    },
  ],
  edges: [
    { id: 'e1', source: 'node_start', target: 'node_llm' },
    { id: 'e2', source: 'node_llm', target: 'node_end' },
  ],
  viewport,
};

// 模板 3：周报助手
const weeklyReportTemplate: WorkflowTemplateData = {
  nodes: [
    {
      id: 'node_start',
      type: 'startNode',
      position: { x: 50, y: 200 },
      data: {
        title: '开始',
        description: '粘贴本周工作内容',
        expand: true,
        parameters: [
          {
            id: 'p1',
            name: 'work',
            dataType: 'String',
            refType: 'input',
            required: true,
            defaultValue: '',
          },
        ],
      },
    },
    {
      id: 'node_llm',
      type: 'llmNode',
      position: { x: 400, y: 200 },
      data: {
        title: '整理周报',
        description: '把零散工作内容整理成结构化周报',
        expand: true,
        llmId: 'deepseek-v4-flash',
        systemPrompt: '你是一位高效的行政助理，擅长把零散信息整理成专业文档。',
        userPrompt:
          '请把以下本周工作内容整理成结构化周报，包含：本周完成、进行中、下周计划、风险与问题四部分：\n{{work}}',
        temperature: 0.5,
        outType: 'text',
        parameters: [
          { id: 'lp1', name: 'work', refType: 'ref', ref: 'node_start.work' },
        ],
        outputDefs: [{ id: 'lo1', name: 'output', dataType: 'String' }],
      },
    },
    {
      id: 'node_end',
      type: 'endNode',
      position: { x: 800, y: 200 },
      data: {
        title: '结束',
        description: '返回周报结果',
        expand: true,
        outputDefs: [
          { id: 'o1', name: 'result', refType: 'ref', ref: 'node_llm.output' },
        ],
      },
    },
  ],
  edges: [
    { id: 'e1', source: 'node_start', target: 'node_llm' },
    { id: 'e2', source: 'node_llm', target: 'node_end' },
  ],
  viewport,
};

// 模板 4：翻译助手
const translationTemplate: WorkflowTemplateData = {
  nodes: [
    {
      id: 'node_start',
      type: 'startNode',
      position: { x: 50, y: 150 },
      data: {
        title: '开始',
        description: '输入原文与目标语言',
        expand: true,
        parameters: [
          {
            id: 'p1',
            name: 'text',
            dataType: 'String',
            refType: 'input',
            required: true,
            defaultValue: '',
          },
          {
            id: 'p2',
            name: 'target',
            dataType: 'String',
            refType: 'input',
            required: true,
            defaultValue: 'English',
          },
        ],
      },
    },
    {
      id: 'node_llm',
      type: 'llmNode',
      position: { x: 420, y: 150 },
      data: {
        title: '翻译',
        description: '调用大模型翻译',
        expand: true,
        llmId: 'deepseek-v4-flash',
        systemPrompt: '你是一位专业翻译，翻译准确、自然、符合目标语言习惯。',
        userPrompt: '请将以下内容翻译成{{target}}，只输出译文：\n{{text}}',
        temperature: 0.3,
        outType: 'text',
        parameters: [
          { id: 'lp1', name: 'text', refType: 'ref', ref: 'node_start.text' },
          { id: 'lp2', name: 'target', refType: 'ref', ref: 'node_start.target' },
        ],
        outputDefs: [{ id: 'lo1', name: 'output', dataType: 'String' }],
      },
    },
    {
      id: 'node_end',
      type: 'endNode',
      position: { x: 850, y: 150 },
      data: {
        title: '结束',
        description: '返回译文',
        expand: true,
        outputDefs: [
          { id: 'o1', name: 'result', refType: 'ref', ref: 'node_llm.output' },
        ],
      },
    },
  ],
  edges: [
    { id: 'e1', source: 'node_start', target: 'node_llm' },
    { id: 'e2', source: 'node_llm', target: 'node_end' },
  ],
  viewport,
};

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'product-copy',
    title: '产品卖点文案',
    description: '输入产品名，AI 一键生成 5 条简洁有力的卖点文案',
    tags: ['营销', '文案'],
    emoji: '📣',
    data: productCopyTemplate,
  },
  {
    id: 'video-script',
    title: '短视频脚本',
    description: '输入主题，生成 60 秒口播脚本（钩子 + 主体 + 引导）',
    tags: ['视频', '脚本'],
    emoji: '🎬',
    data: videoScriptTemplate,
  },
  {
    id: 'weekly-report',
    title: '周报助手',
    description: '粘贴零散工作内容，自动整理成结构化周报',
    tags: ['办公', '周报'],
    emoji: '📝',
    data: weeklyReportTemplate,
  },
  {
    id: 'translator',
    title: '翻译助手',
    description: '输入原文和目标语言，快速获得自然译文',
    tags: ['翻译'],
    emoji: '🌐',
    data: translationTemplate,
  },
];

// ===== 模板/生成工作流模型规范化 =====
// AI 生成或模板中的 llmId 可能是未配置的模型（幻觉/默认值），
// 统一替换为「模型配置」中的第一个可用模型，保证画布上的工作流立即可用
export async function normalizeWorkflowModels(workflow: unknown): Promise<void> {
  const wf = workflow as {
    nodes?: Array<{ type?: string; data?: Record<string, unknown> }>;
  };
  if (!wf?.nodes?.length) return;
  try {
    const res = await fetch('/api/ai/models');
    const models = await res.json();
    if (!Array.isArray(models) || models.length === 0) return; // 未配置模型，保留原样（画布会提示）
    const ids = new Set(models.map((m) => m.id));
    const fallbackId = models[0].id;
    for (const node of wf.nodes) {
      const data = node.data;
      if (node.type === 'llmNode' && data?.llmId && !ids.has(String(data.llmId))) {
        console.warn(`[workflow] 模型「${data.llmId}」未配置，已替换为「${fallbackId}」`);
        data.llmId = fallbackId;
      }
    }
  } catch {
    // 拉取模型失败时不做规范化，保持原样
  }
}
