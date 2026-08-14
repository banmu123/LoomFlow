import type { FlowNode, FlowContext } from '../types';
import { BaseExecutor } from './BaseExecutor';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';
import { supabase } from '@/lib/supabase/server';

export class KnowledgeExecutor extends BaseExecutor {
  constructor(paramResolver: ParameterResolver, exprEvaluator: ExpressionEvaluator) {
    super(paramResolver, exprEvaluator);
  }

  validate(node: FlowNode): string | null {
    const data = node.data as Record<string, unknown>;
    if (!data.keyword) return '知识库节点缺少 keyword';
    if (!data.knowledgeId) return '知识库节点未选择知识库（请在配置中选择）';
    return null;
  }

  async execute(node: FlowNode, context: FlowContext): Promise<Record<string, unknown>> {
    const data = node.data;
    const keyword = data.keyword
      ? this.paramResolver.interpolateTemplate(String(data.keyword), context)
      : '';
    const knowledgeId = String(data.knowledgeId || '');
    const limit = Math.min(Number(data.limit || 5), 20);

    if (!keyword) throw new Error('知识库节点缺少关键词');
    if (!knowledgeId) throw new Error('知识库节点未选择知识库');

    // 校验知识库归属（按执行者用户隔离；分享执行以工作流主人身份）
    const { data: kb } = await supabase
      .from('knowledge_bases')
      .select('id, user_id')
      .eq('id', knowledgeId)
      .single();

    if (!kb) throw new Error('知识库不存在或已被删除');
    if (context.userId && kb.user_id !== context.userId) {
      throw new Error('无权访问该知识库');
    }

    // 关键词检索：标题/内容 ILIKE 匹配（MVP 关键词检索，后续可升级向量检索）
    const { data: docs, error } = await supabase
      .from('knowledge_documents')
      .select('id, title, content')
      .eq('knowledge_base_id', knowledgeId)
      .or(`title.ilike.%${keyword}%,content.ilike.%${keyword}%`)
      .limit(limit);

    if (error) throw new Error(`知识库检索失败: ${error.message}`);

    return {
      results: (docs ?? []).map((d: { id: string; title: string; content: string }) => ({
        id: d.id,
        title: d.title,
        // 摘要：截取命中片段前后文
        snippet: d.content.slice(0, 500),
      })),
      keyword,
    };
  }
}
