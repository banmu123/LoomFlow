import type { FlowNode, FlowContext } from '../types';
import { BaseExecutor } from './BaseExecutor';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';

export class KnowledgeExecutor extends BaseExecutor {
  constructor(paramResolver: ParameterResolver, exprEvaluator: ExpressionEvaluator) {
    super(paramResolver, exprEvaluator);
  }

  async execute(node: FlowNode, context: FlowContext): Promise<Record<string, unknown>> {
    const data = node.data;
    const keyword = data.keyword
      ? this.paramResolver.interpolateTemplate(data.keyword, context)
      : '';

    if (!keyword) throw new Error('知识库节点缺少关键词');

    const knowledgeId = data.knowledgeId;
    const limit = Number(data.limit || 5);

    // TODO: 对接知识库集成服务
    // 当前通过 Web Search 进行知识检索作为兜底
    const searchUrl = `https://api.coze.cn/v1/knowledge/search`;

    const response = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.COZE_AUTH_TOKEN || ''}`,
      },
      body: JSON.stringify({
        knowledge_id: knowledgeId,
        query: keyword,
        limit,
      }),
    });

    if (!response.ok) {
      throw new Error(`知识库检索失败: HTTP ${response.status}`);
    }

    const result = await response.json();
    return {
      results: result.data || [],
      keyword,
    };
  }
}
