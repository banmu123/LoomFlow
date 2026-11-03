import type { TinyflowData } from '@/lib/tinyflow/types';
import type { BenchmarkCase, BenchmarkNodeType } from '../types';

export const PARAMS: Partial<Record<BenchmarkNodeType, Record<string, unknown>>> = {
  llmNode: { llmId: 'deepseek-v4-flash' },
  pythonToolNode: { tool: 'data.analyze' },
  knowledgeNode: { knowledgeId: 'kb-1' },
  httpNode: { url: 'https://example.com/data' },
  conditionNode: { condition: 'amount > 1000' },
  agentNode: { goal: '查询竞品价格', llmId: 'deepseek-v4-flash', mcpServerId: 'srv-1' },
  codeNode: { code: 'return inputs;' },
  templateNode: { template: '{{value}}' },
};

/** 按期望节点顺序构造一条合法链路（测试用基准生成器） */
export function buildWorkflow(caseDef: BenchmarkCase): TinyflowData {
  const nodes = caseDef.expectedNodeTypes.map((type, index) => ({
    id: `${type}-${index}`,
    type,
    position: { x: index * 120, y: 0 },
    data: { title: type, ...(PARAMS[type] ?? {}) },
  }));

  const edges = nodes.slice(0, -1).map((node, index) => ({
    id: `e-${index}`,
    source: node.id,
    target: nodes[index + 1].id,
  }));

  return { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } } as unknown as TinyflowData;
}
