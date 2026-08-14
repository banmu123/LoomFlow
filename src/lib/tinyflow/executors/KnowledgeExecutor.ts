import type { FlowNode, FlowContext } from '../types';
import { BaseExecutor } from './BaseExecutor';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';
import { supabase } from '@/lib/supabase/server';

// 从长问句提取检索词：
// - 中文：4 字滑动窗口（能覆盖文档中的连续片段，如"开发流程"）
// - 英文：按空格拆词
// 去重后最多 8 个（PostgREST or 子句数量限制内）
const SEARCH_STOP_WORDS = ['这个', '那个', '什么', '怎么', '有没有', '为什么', '是不是', '如何', '应该', '可以', '一下', '请帮', '帮我'];

function buildSearchTerms(keyword: string): string[] {
  const parts = keyword
    .replace(/[，。！？、；：""''（）\s,\.!?;:\(\)\[\]「」『』]/g, ' ')
    .split(/\s+/)
    .filter((s) => s.length >= 2);

  const terms: string[] = [];
  for (const part of parts) {
    if (/[一-龥]/.test(part)) {
      // 中文：滑动窗口提取连续片段；纯停用词窗口跳过
      for (let i = 0; i + 4 <= part.length; i++) {
        const w = part.slice(i, i + 4);
        if (SEARCH_STOP_WORDS.some((s) => w.includes(s))) continue;
        terms.push(w);
      }
      // 整段不足 4 字时直接使用
      if (part.length < 4) terms.push(part);
    } else {
      terms.push(part);
    }
  }

  return [...new Set(terms)].slice(0, 8);
}

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

    // 拆词检索：长问句整句 ILIKE 几乎无法命中，改为提取词片段后多词 OR 匹配
    const terms = buildSearchTerms(keyword);
    if (terms.length === 0) {
      return { results: [], documents: [], keyword };
    }
    const orClauses = terms
      .map((t) => `title.ilike.%${t}%,content.ilike.%${t}%`)
      .join(',');

    const { data: docs, error } = await supabase
      .from('knowledge_documents')
      .select('id, title, content')
      .eq('knowledge_base_id', knowledgeId)
      .or(orClauses)
      .limit(limit);

    if (error) throw new Error(`知识库检索失败: ${error.message}`);

    const results = (docs ?? []).map((d: { id: string; title: string; content: string }) => ({
      id: d.id,
      title: d.title,
      // content：完整文本（截断 3000 字，供后续节点拼接）
      content: d.content.slice(0, 3000),
      // snippet：命中片段摘要（500 字）
      snippet: d.content.slice(0, 500),
    }));

    return {
      // documents：主字段（与 AI 生成规范 prompts 的输出契约一致：{documents: [{title, content}]}）
      documents: results,
      // results：兼容别名（早期工作流引用）
      results,
      keyword,
    };
  }
}
