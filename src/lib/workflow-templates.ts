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
  category: string; // 行业/场景分类
  emoji: string;
  data: WorkflowTemplateData;
}

// 场景分类常量
export const TEMPLATE_CATEGORIES = [
  { id: 'office', label: '办公效率' },
  { id: 'marketing', label: '营销文案' },
  { id: 'sales', label: '销售客服' },
  { id: 'data', label: '数据处理' },
  { id: 'content', label: '内容创作' },
  { id: 'operations', label: '运营自动化' },
] as const;

const viewport = { x: 250, y: 100, zoom: 1 };

// ===== 模板工厂：LLM 单节点工作流（最常见形态）=====
// 统一生成「开始 → LLM → 结束」结构，减少重复代码
function makeLlmTemplate(opts: {
  inputName: string;
  inputLabel: string;
  systemPrompt: string;
  userPrompt: string;
  extraInputs?: Array<{ name: string; label: string; defaultValue?: string }>;
  temperature?: number;
}): WorkflowTemplateData {
  const inputNodes = [
    {
      id: 'node_start',
      type: 'startNode',
      position: { x: 50, y: 200 },
      data: {
        title: '开始',
        description: opts.inputLabel,
        expand: true,
        parameters: [
          {
            id: 'p1',
            name: opts.inputName,
            dataType: 'String',
            refType: 'input',
            required: true,
            defaultValue: '',
          },
          ...(opts.extraInputs ?? []).map((ei, i) => ({
            id: `p${i + 2}`,
            name: ei.name,
            dataType: 'String',
            refType: 'input',
            required: true,
            defaultValue: ei.defaultValue ?? '',
          })),
        ],
      },
    },
  ];
  const llmParams = [
    { id: 'lp1', name: opts.inputName, refType: 'ref', ref: `node_start.${opts.inputName}` },
    ...(opts.extraInputs ?? []).map((ei, i) => ({
      id: `lp${i + 2}`,
      name: ei.name,
      refType: 'ref',
      ref: `node_start.${ei.name}`,
    })),
  ];
  return {
    nodes: [
      ...inputNodes,
      {
        id: 'node_llm',
        type: 'llmNode',
        position: { x: 400, y: 200 },
        data: {
          title: 'AI 处理',
          description: '调用大模型处理',
          expand: true,
          llmId: 'deepseek-v4-flash',
          systemPrompt: opts.systemPrompt,
          userPrompt: opts.userPrompt,
          temperature: opts.temperature ?? 0.7,
          outType: 'text',
          parameters: llmParams,
          outputDefs: [{ id: 'lo1', name: 'output', dataType: 'String' }],
        },
      },
      {
        id: 'node_end',
        type: 'endNode',
        position: { x: 800, y: 200 },
        data: {
          title: '结束',
          description: '返回结果',
          expand: true,
          outputDefs: [{ id: 'o1', name: 'result', refType: 'ref', ref: 'node_llm.output' }],
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'node_start', target: 'node_llm' },
      { id: 'e2', source: 'node_llm', target: 'node_end' },
    ],
    viewport,
  };
}

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
    category: 'marketing',
    emoji: '📣',
    data: productCopyTemplate,
  },
  {
    id: 'video-script',
    title: '短视频脚本',
    description: '输入主题，生成 60 秒口播脚本（钩子 + 主体 + 引导）',
    tags: ['视频', '脚本'],
    category: 'content',
    emoji: '🎬',
    data: videoScriptTemplate,
  },
  {
    id: 'weekly-report',
    title: '周报助手',
    description: '粘贴零散工作内容，自动整理成结构化周报',
    tags: ['办公', '周报'],
    category: 'office',
    emoji: '📝',
    data: weeklyReportTemplate,
  },
  {
    id: 'translator',
    title: '翻译助手',
    description: '输入原文和目标语言，快速获得自然译文',
    tags: ['翻译'],
    category: 'office',
    emoji: '🌐',
    data: translationTemplate,
  },
  {
    id: 'daily-news',
    title: '每日行业要闻',
    description: '输入行业关键词，AI 自动汇总当天重要资讯（可配定时任务每天推送）',
    tags: ['资讯', '定时'],
    category: 'operations',
    emoji: '📰',
    data: makeLlmTemplate({
      inputName: 'industry',
      inputLabel: '行业关键词',
      systemPrompt: '你是一位资深的行业分析师，擅长从信息中提炼要点。',
      userPrompt:
        '请根据「{{industry}}」行业，列出现在最值得关注的 5 条要闻要点（如无实时数据，基于你的知识给出行业动态方向）。每条一句话，按重要程度排序。',
      temperature: 0.6,
    }),
  },
  {
    id: 'customer-reply',
    title: '客户回复助手',
    description: '输入客户咨询内容，AI 生成专业得体的标准回复',
    tags: ['客服', '销售'],
    category: 'sales',
    emoji: '💬',
    data: makeLlmTemplate({
      inputName: 'question',
      inputLabel: '客户咨询内容',
      systemPrompt: '你是一位专业的客服经理，回复亲切、专业、解决问题导向。',
      userPrompt:
        '请针对以下客户咨询生成得体回复，要求：语气亲切专业、直接回答问题、给出可操作建议、结尾留出进一步沟通空间：\n{{question}}',
      temperature: 0.6,
    }),
  },
  {
    id: 'meeting-minutes',
    title: '会议纪要',
    description: '粘贴会议原始记录，AI 整理成结构化纪要（结论/待办/负责人）',
    tags: ['办公', '会议'],
    category: 'office',
    emoji: '📋',
    data: makeLlmTemplate({
      inputName: 'notes',
      inputLabel: '会议原始记录',
      systemPrompt: '你是一位高效的会议记录专家。',
      userPrompt:
        '请将以下会议原始记录整理成结构化纪要，包含：会议主题、讨论要点、最终结论、行动项（含负责人与时间）、风险提醒：\n{{notes}}',
      temperature: 0.4,
    }),
  },
  {
    id: 'email-polish',
    title: '邮件润色',
    description: '输入草稿邮件，AI 润色为专业得体的正式邮件',
    tags: ['办公', '邮件'],
    category: 'office',
    emoji: '✉️',
    data: makeLlmTemplate({
      inputName: 'draft',
      inputLabel: '邮件草稿',
      systemPrompt: '你是一位商务写作专家，擅长正式得体的邮件表达。',
      userPrompt: '请将以下邮件草稿润色为专业正式的商务邮件，保持原意，优化措辞和结构：\n{{draft}}',
      temperature: 0.5,
    }),
  },
  {
    id: 'job-description',
    title: '招聘 JD 生成',
    description: '输入岗位名称和职责要点，AI 生成完整招聘启事',
    tags: ['人事', '招聘'],
    category: 'office',
    emoji: '👥',
    data: makeLlmTemplate({
      inputName: 'job',
      inputLabel: '岗位与职责要点',
      systemPrompt: '你是一位 HR 招聘专家，擅长撰写吸引人的职位描述。',
      userPrompt:
        '请根据以下信息生成一份完整招聘 JD，包含：岗位职责、任职要求、加分项、薪资福利（留空让企业填写）、公司亮点模板：\n{{job}}',
      temperature: 0.6,
    }),
  },
  {
    id: 'article-blog',
    title: '公众号文章',
    description: '输入主题和大纲，AI 生成完整公众号文章',
    tags: ['内容', '写作'],
    category: 'content',
    emoji: '📄',
    data: makeLlmTemplate({
      inputName: 'topic',
      inputLabel: '文章主题',
      systemPrompt: '你是一位资深公众号写手，熟悉公众号文章结构与爆款逻辑。',
      userPrompt:
        '请以「{{topic}}」为主题写一篇 1500 字左右的公众号文章。要求：吸引人的开头（抛出痛点）、分 3-4 个小节展开（每个小节有观点+案例）、金句点缀、结尾行动号召。输出正文即可。',
      temperature: 0.8,
    }),
  },
  {
    id: 'data-summary',
    title: '数据总结分析',
    description: '粘贴数据或报表，AI 提炼关键指标和洞察',
    tags: ['数据', '分析'],
    category: 'data',
    emoji: '📊',
    data: makeLlmTemplate({
      inputName: 'data',
      inputLabel: '数据内容',
      systemPrompt: '你是一位数据分析师，擅长从数据中发现洞察。',
      userPrompt:
        '请分析以下数据，提炼：关键指标变化、突出发现、异常点、以及给管理者的 3 条建议：\n{{data}}',
      temperature: 0.5,
    }),
  },
  {
    id: 'contract-extract',
    title: '合同要点提取',
    description: '粘贴合同文本，AI 提取关键条款和风险点',
    tags: ['法务', '合同'],
    category: 'data',
    emoji: '📑',
    data: makeLlmTemplate({
      inputName: 'contract',
      inputLabel: '合同文本',
      systemPrompt: '你是一位审慎的合同法务顾问。',
      userPrompt:
        '请从以下合同中提取：核心条款摘要、金额与期限、违约责任、对我方不利的风险点、建议关注事项：\n{{contract}}',
      temperature: 0.3,
    }),
  },
  {
    id: 'social-content',
    title: '小红书文案',
    description: '输入主题，AI 生成小红书爆款笔记（标题+正文+标签）',
    tags: ['内容', '小红书'],
    category: 'content',
    emoji: '📕',
    data: makeLlmTemplate({
      inputName: 'topic',
      inputLabel: '笔记主题',
      systemPrompt: '你是一位小红书爆款笔记专家，熟悉平台语言风格。',
      userPrompt:
        '以「{{topic}}」为主题写一篇小红书笔记：1个抓眼球的标题（含 emoji）、正文（口语化、有干货、分段、含 emoji）、5-8 个相关标签。',
      temperature: 0.8,
    }),
  },
  {
    id: 'summarize-doc',
    title: '长文摘要',
    description: '粘贴长文档，AI 压缩成 200 字精华摘要',
    tags: ['办公', '摘要'],
    category: 'office',
    emoji: '📌',
    data: makeLlmTemplate({
      inputName: 'doc',
      inputLabel: '长文档内容',
      systemPrompt: '你是一位精炼的文档摘要专家。',
      userPrompt: '请将以下长文档压缩为 200 字以内的精华摘要，保留核心观点和数据：\n{{doc}}',
      temperature: 0.3,
    }),
  },
  {
    id: 'seo-title',
    title: 'SEO 标题生成',
    description: '输入文章核心词，AI 生成 10 个高点击率标题',
    tags: ['运营', 'SEO'],
    category: 'operations',
    emoji: '🔍',
    data: makeLlmTemplate({
      inputName: 'keyword',
      inputLabel: '核心关键词',
      systemPrompt: '你是一位 SEO 内容专家。',
      userPrompt: '围绕关键词「{{keyword}}」生成 10 个高点击率的文章标题，包含数字、悬念、利益点等元素，每个不超过 25 字。',
      temperature: 0.8,
    }),
  },
  {
    id: 'market-analysis',
    title: '竞品分析',
    description: '输入竞品名称，AI 生成竞品分析框架（优势/劣势/机会）',
    tags: ['市场', '分析'],
    category: 'marketing',
    emoji: '🎯',
    data: makeLlmTemplate({
      inputName: 'competitor',
      inputLabel: '竞品名称',
      systemPrompt: '你是一位市场分析师。',
      userPrompt:
        '请对「{{competitor}}」做一份竞品分析：产品定位、核心功能、目标用户、优势、劣势、对我们的机会与威胁、差异化建议。',
      temperature: 0.6,
    }),
  },
  {
    id: 'promo-plan',
    title: '营销活动方案',
    description: '输入活动目标和产品，AI 生成完整营销活动策划',
    tags: ['营销', '策划'],
    category: 'marketing',
    emoji: '🚀',
    data: makeLlmTemplate({
      inputName: 'goal',
      inputLabel: '活动目标与产品',
      systemPrompt: '你是一位营销策划专家。',
      userPrompt:
        '针对「{{goal}}」生成一份营销活动方案：活动主题、目标人群、核心玩法、渠道策略、时间线、预算分配建议、效果预估指标。',
      temperature: 0.7,
    }),
  },
  {
    id: 'cs-ticket',
    title: '客诉分类处理',
    description: '输入客诉内容，AI 判断严重程度并给出处理建议',
    tags: ['客服', '售后'],
    category: 'sales',
    emoji: '🛠️',
    data: makeLlmTemplate({
      inputName: 'complaint',
      inputLabel: '客诉内容',
      systemPrompt: '你是一位售后管理专家。',
      userPrompt:
        '分析以下客诉：1. 问题分类（产品/物流/服务/其他）2. 严重程度（低/中/高）3. 处理优先级 4. 建议处理方案 5. 需要升级处理的条件：\n{{complaint}}',
      temperature: 0.5,
    }),
  },
  {
    id: 'content-calendar',
    title: '内容排期规划',
    description: '输入业务方向和频率，AI 生成 2 周内容排期表',
    tags: ['运营', '内容'],
    category: 'operations',
    emoji: '🗓️',
    data: makeLlmTemplate({
      inputName: 'business',
      inputLabel: '业务方向',
      systemPrompt: '你是一位内容运营总监。',
      userPrompt:
        '基于「{{business}}」业务方向，生成一份 2 周内容排期表：每天 1 条内容，包含选题、形式（图文/视频/海报）、目标。内容要覆盖引流/种草/转化/品牌四种类型。',
      temperature: 0.7,
    }),
  },
  {
    id: 'code-explain',
    title: '代码解释',
    description: '粘贴代码片段，AI 逐段解释功能与逻辑',
    tags: ['技术', '代码'],
    category: 'data',
    emoji: '💻',
    data: makeLlmTemplate({
      inputName: 'code',
      inputLabel: '代码片段',
      systemPrompt: '你是一位耐心的技术导师。',
      userPrompt: '请逐段解释以下代码：每段的功能、关键逻辑、潜在问题、如何改进：\n{{code}}',
      temperature: 0.3,
    }),
  },
  {
    id: 'faq-generator',
    title: 'FAQ 生成',
    description: '输入产品或业务说明，AI 生成常见问题问答集',
    tags: ['运营', '客服'],
    category: 'operations',
    emoji: '❓',
    data: makeLlmTemplate({
      inputName: 'product',
      inputLabel: '产品/业务说明',
      systemPrompt: '你是一位产品运营专家。',
      userPrompt:
        '基于以下产品/业务说明，生成 15 条用户最可能问的 FAQ（问题+简洁答案）：\n{{product}}',
      temperature: 0.5,
    }),
  },
  {
    id: 'training-plan',
    title: '新员工培训计划',
    description: '输入岗位和周期，AI 生成分阶段培训计划',
    tags: ['人事', '培训'],
    category: 'office',
    emoji: '🎓',
    data: makeLlmTemplate({
      inputName: 'position',
      inputLabel: '岗位与培训周期',
      systemPrompt: '你是一位企业培训专家。',
      userPrompt:
        '针对「{{position}}」岗位生成一份分阶段新员工培训计划：第 1 周（熟悉）、第 2-4 周（上手）、第 5-8 周（独立）、每阶段的学习内容/考核方式/导师安排。',
      temperature: 0.6,
    }),
  },
  {
    id: 'weekly-plan',
    title: '周计划生成',
    description: '输入本周目标和事项，AI 排成优先级计划',
    tags: ['办公', '效率'],
    category: 'office',
    emoji: '📅',
    data: makeLlmTemplate({
      inputName: 'goals',
      inputLabel: '本周目标与事项',
      systemPrompt: '你是一位时间管理专家。',
      userPrompt:
        '根据以下目标与事项，生成本周工作计划：按优先级排序、分配到周一至周五、标注关键节点和完成标准：\n{{goals}}',
      temperature: 0.5,
    }),
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
