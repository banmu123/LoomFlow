import type { FlowNode, FlowContext } from '../types';
import { BaseExecutor } from './BaseExecutor';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';
import { getSearchProviderById } from '@/lib/search/db-providers';
import { createSearchProvider } from '@/lib/search/providers';

// ===== 搜索节点执行器 =====
// 通过 Search Provider 系统执行搜索（不再直接调用具体服务）：
//   node.data.engine    → 已配置的搜索服务 id（画布内置面板字段，管理后台 → 搜索配置）
//   node.data.provider  → 兼容旧配置（NodeConfigPanel / AI 生成）
//   node.data.query     → 搜索关键词（支持 {{var}} 插值）
//   node.data.maxResults→ 返回数量
// 兼容旧配置：keyword/limit + SEARCH_API_URL 环境变量回退
export class SearchEngineExecutor extends BaseExecutor {
  constructor(paramResolver: ParameterResolver, exprEvaluator: ExpressionEvaluator) {
    super(paramResolver, exprEvaluator);
  }

  validate(node: FlowNode): string | null {
    const data = node.data as Record<string, unknown>;
    if (!data.query && !data.keyword) return '搜索节点缺少搜索关键词（query）';
    return null;
  }

  async execute(node: FlowNode, context: FlowContext): Promise<Record<string, unknown>> {
    const data = node.data as Record<string, unknown>;
    const rawQuery = (data.query ?? data.keyword) as string;
    const keyword = rawQuery
      ? this.paramResolver.interpolateTemplate(rawQuery, context)
      : '';

    if (!keyword) throw new Error('搜索节点缺少搜索关键词');

    const maxResults = Number(data.maxResults ?? data.limit ?? 5) || 5;
    // engine = 画布内置面板字段（tinyflow 约定）；provider = NodeConfigPanel/AI 生成旧字段
    const providerId = data.engine ? String(data.engine) : data.provider ? String(data.provider) : '';

    // ===== 新逻辑：通过 Search Provider 系统 =====
    if (providerId) {
      const def = await getSearchProviderById(providerId);
      if (!def) {
        throw new Error(
          `未知搜索服务: ${providerId}，请在「搜索配置」中添加或修改搜索节点`,
        );
      }
      if (!def.enabled) {
        throw new Error(
          `搜索服务「${def.label || def.id}」已禁用，请到「搜索配置」启用`,
        );
      }
      const provider = createSearchProvider(def);
      const { results } = await provider.search(keyword, { maxResults });
      return { results, keyword };
    }

    // ===== 旧逻辑：环境变量 SEARCH_API_URL 回退 =====
    const searchUrl = process.env.SEARCH_API_URL;
    if (!searchUrl) {
      throw new Error(
        '搜索服务未配置（请先在「搜索配置」中添加搜索服务，或配置 SEARCH_API_URL）',
      );
    }

    const response = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.SEARCH_API_KEY
          ? { Authorization: `Bearer ${process.env.SEARCH_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({ query: keyword, limit: maxResults }),
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
