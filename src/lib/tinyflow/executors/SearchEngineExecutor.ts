import type { FlowNode, FlowContext } from '../types';
import { BaseExecutor } from './BaseExecutor';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';

export class SearchEngineExecutor extends BaseExecutor {
  constructor(paramResolver: ParameterResolver, exprEvaluator: ExpressionEvaluator) {
    super(paramResolver, exprEvaluator);
  }

  validate(node: FlowNode): string | null {
    const data = node.data as Record<string, unknown>;
    if (!data.keyword) return '搜索节点缺少 keyword';
    return null;
  }

  async execute(node: FlowNode, context: FlowContext): Promise<Record<string, unknown>> {
    const { SearchClient, Config } = await import('coze-coding-dev-sdk');

    const data = node.data;
    const keyword = data.keyword
      ? this.paramResolver.interpolateTemplate(data.keyword, context)
      : '';

    if (!keyword) throw new Error('搜索引擎节点缺少关键词');

    const limit = Number(data.limit || 5);

    // 使用 coze-coding-dev-sdk 的 SearchClient
    const config = new Config({
      apiKey: process.env.COZE_API_KEY || '',
      baseUrl: process.env.COZE_API_BASE || '',
    });

    const client = new SearchClient(config);

    const response = await client.webSearch(keyword, limit);

    return {
      results: response?.web_items || [],
      keyword,
    };
  }
}
