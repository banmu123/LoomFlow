import type { BenchmarkDataset } from './types';

/**
 * 工作流生成评测集 v1。
 *
 * 设计约束：
 * - 只使用 NodeRegistry 中真实存在的节点类型；
 * - 约束是机器可判定的（边关系/节点数/参数字段），不写"要合理"这类无法验证的描述；
 * - 不绑定具体模型，模型差异通过 A/B 报告体现。
 */
export const BENCHMARK_DATASET_V1: BenchmarkDataset = {
  version: 'wf-gen-v1',
  description: '自然语言 → 工作流生成的意图理解与结构正确性基准（10 个案例）',
  cases: [
    {
      id: 'case-01',
      title: '产品调研 + 卖点提取 + 推广文案',
      input: '搜索某产品的资料，提取产品卖点，并生成推广文案。',
      expectedIntent: '先检索资料，再由模型提炼卖点并产出文案',
      expectedNodeTypes: ['startNode', 'searchEngineNode', 'llmNode', 'endNode'],
      forbiddenNodeTypes: ['loopNode'],
      constraints: [
        { type: 'edge_between', from: 'searchEngineNode', to: 'llmNode', label: '搜索结果必须进入 LLM' },
        { type: 'param_present', nodeType: 'llmNode', field: 'llmId' },
        { type: 'node_count_max', max: 6 },
      ],
      expectedOutput: '一段可发布的推广文案',
      evaluationRules: ['schema', 'semantics', 'constraints'],
    },
    {
      id: 'case-02',
      title: 'CSV 统计平均值与最大值',
      input: '读取 CSV 文件，计算平均值和最大值，再输出统计结果。',
      expectedIntent: '解析表格并计算统计量',
      expectedNodeTypes: ['startNode', 'pythonToolNode', 'endNode'],
      forbiddenNodeTypes: ['searchEngineNode', 'agentNode'],
      constraints: [
        { type: 'param_present', nodeType: 'pythonToolNode', field: 'tool' },
        { type: 'node_count_max', max: 4 },
      ],
      expectedOutput: '包含平均值与最大值的统计结果',
      evaluationRules: ['schema', 'semantics', 'constraints'],
    },
    {
      id: 'case-03',
      title: '基于内部知识库回答',
      input: '根据公司知识库回答员工报销流程，并给出出处。',
      expectedIntent: '检索知识库后由模型总结回答',
      expectedNodeTypes: ['startNode', 'knowledgeNode', 'llmNode', 'endNode'],
      forbiddenNodeTypes: ['searchEngineNode'],
      constraints: [
        { type: 'edge_between', from: 'knowledgeNode', to: 'llmNode', label: '知识库结果进入 LLM' },
        { type: 'param_present', nodeType: 'knowledgeNode', field: 'knowledgeId' },
      ],
      evaluationRules: ['schema', 'semantics', 'constraints'],
    },
    {
      id: 'case-04',
      title: '抓取网页并生成摘要',
      input: '抓取指定网址的内容，生成 200 字摘要。',
      expectedIntent: 'HTTP 抓取 + 模型摘要',
      expectedNodeTypes: ['startNode', 'httpNode', 'llmNode', 'endNode'],
      forbiddenNodeTypes: ['knowledgeNode'],
      constraints: [
        { type: 'edge_between', from: 'httpNode', to: 'llmNode' },
        { type: 'param_present', nodeType: 'httpNode', field: 'url' },
      ],
      evaluationRules: ['schema', 'semantics', 'constraints'],
    },
    {
      id: 'case-05',
      title: '金额超限走人工确认',
      input: '读取订单金额，如果超过 1000 元就等待人工确认，否则直接通过。',
      expectedIntent: '条件判断 + 人工确认分支',
      expectedNodeTypes: ['startNode', 'conditionNode', 'confirmNode', 'endNode'],
      forbiddenNodeTypes: ['agentNode'],
      constraints: [
        { type: 'edge_between', from: 'conditionNode', to: 'confirmNode' },
        { type: 'param_present', nodeType: 'conditionNode', field: 'condition' },
      ],
      evaluationRules: ['schema', 'semantics', 'constraints'],
    },
    {
      id: 'case-06',
      title: '批量处理列表',
      input: '对列表中的每个商品生成一句卖点，循环处理全部商品。',
      expectedIntent: '循环节点 + LLM 逐项处理',
      expectedNodeTypes: ['startNode', 'loopNode', 'llmNode', 'endNode'],
      forbiddenNodeTypes: [],
      constraints: [{ type: 'edge_between', from: 'loopNode', to: 'llmNode' }],
      evaluationRules: ['schema', 'semantics', 'constraints'],
    },
    {
      id: 'case-07',
      title: '调用外部工具完成调研',
      input: '使用已配置的 MCP 工具查询竞品价格，汇总后输出对比结论。',
      expectedIntent: 'Agent 动态调用工具并汇总',
      expectedNodeTypes: ['startNode', 'agentNode', 'endNode'],
      forbiddenNodeTypes: ['codeNode'],
      constraints: [
        { type: 'param_present', nodeType: 'agentNode', field: 'goal' },
        { type: 'node_count_max', max: 4 },
      ],
      evaluationRules: ['schema', 'semantics', 'constraints'],
    },
    {
      id: 'case-08',
      title: 'JSON 清洗与重排',
      input: '把输入的 JSON 数组按 score 从高到低排序，只保留 name 和 score 字段。',
      expectedIntent: '代码节点做确定性数据变换',
      expectedNodeTypes: ['startNode', 'codeNode', 'endNode'],
      forbiddenNodeTypes: ['llmNode', 'agentNode'],
      constraints: [{ type: 'param_present', nodeType: 'codeNode', field: 'code' }],
      evaluationRules: ['schema', 'semantics', 'constraints'],
    },
    {
      id: 'case-09',
      title: 'PDF 解析并提炼要点',
      input: '解析上传的 PDF 报告，提炼三条关键结论。',
      expectedIntent: '文档解析 + 模型总结',
      expectedNodeTypes: ['startNode', 'pythonToolNode', 'llmNode', 'endNode'],
      forbiddenNodeTypes: ['excelNode'],
      constraints: [
        { type: 'edge_between', from: 'pythonToolNode', to: 'llmNode' },
        { type: 'param_present', nodeType: 'pythonToolNode', field: 'tool' },
      ],
      evaluationRules: ['schema', 'semantics', 'constraints'],
    },
    {
      id: 'case-10',
      title: 'Excel 汇总表',
      input: '把明细数据汇总成 Excel 表格并输出下载链接。',
      expectedIntent: '表格汇总节点',
      expectedNodeTypes: ['startNode', 'excelNode', 'endNode'],
      forbiddenNodeTypes: ['searchEngineNode'],
      constraints: [{ type: 'node_count_max', max: 4 }],
      evaluationRules: ['schema', 'semantics', 'constraints'],
    },
  ],
};

export const DATASETS = {
  'wf-gen-v1': BENCHMARK_DATASET_V1,
} as const;

export function getDataset(version: string): BenchmarkDataset {
  const dataset = DATASETS[version as keyof typeof DATASETS];
  if (!dataset) throw new Error(`未知评测集版本：${version}`);
  return dataset;
}
