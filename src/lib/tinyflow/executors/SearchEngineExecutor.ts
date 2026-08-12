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
    const data = node.data;
    const keyword = data.keyword
      ? this.paramResolver.interpolateTemplate(data.keyword, context)
      : '';

    if (!keyword) throw new Error('搜索引擎节点缺少关键词');

    const limit = Number(data.limit || 5);

    // 搜索服务端点需在环境变量配置（SEARCH_API_URL / SEARCH_API_KEY）
    const searchUrl = process.env.SEARCH_API_URL;
    if (!searchUrl) {
      throw new Error('搜索服务未配置（SEARCH_API_URL），请联系管理员配置后使用');
    }

    const response = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.SEARCH_API_KEY
          ? { Authorization: `Bearer ${process.env.SEARCH_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({ query: keyword, limit }),
    });

    if (!response.ok) {
      throw new Error(`搜索服务请求失败 (${response.status})`);
    }

    const result = await response.json();
    const items = Array.isArray(result?.results)
      ? result.results
      : Array.isArray(result)
        ? result
        : [];

    return {
      results: items,
      keyword,
    };
  }
}
