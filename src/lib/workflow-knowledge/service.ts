/**
 * Workflow Knowledge Service
 *
 * 核心服务：索引、检索、推荐工作流知识
 * 不引入复杂向量数据库，使用 PostgreSQL 全文搜索 + 结构化匹配
 */

import { supabase } from '../supabase/server';
import type { TinyflowData } from '../tinyflow/types';
import type {
  WorkflowKnowledge,
  WorkflowMatch,
  MatchReason,
  ReusableNode,
  WorkflowExperience,
  KnowledgeQuery,
  ReusablePattern,
  SuggestedNode,
} from './types';

// ===== 1. 工作流知识索引 =====

/**
 * 从 workflow_history + flow_runs + workflow_versions 构建工作流知识
 * 这是一个聚合查询，不需要额外存储
 */
export async function indexWorkflowKnowledge(
  userId: string,
  workflowId?: string,
): Promise<WorkflowKnowledge[]> {
  // 查询工作流基本信息
  let query = supabase
    .from('workflow_history')
    .select(`
      id,
      title,
      description,
      user_id,
      data,
      saved,
      published,
      created_at,
      updated_at
    `)
    .eq('user_id', userId)
    .eq('saved', true);

  if (workflowId) {
    query = query.eq('id', workflowId);
  }

  const { data: workflows, error } = await query;
  if (error || !workflows) {
    console.error('[KnowledgeService] Failed to fetch workflows:', error);
    return [];
  }

  // 批量获取执行统计
  const workflowIds = workflows.map((w: { id: string }) => w.id);
  const runStats = await getRunStats(workflowIds);
  const versionCounts = await getVersionCounts(workflowIds);
  const notes = await getWorkflowNotes(workflowIds);

  // 构建知识条目
  return workflows.map((w: { id: string; title: string; description: string | null; user_id: string; data: unknown; created_at: string; updated_at: string; published: boolean }) => {
    const data = w.data as TinyflowData;
    const stats = runStats[w.id] || { totalRuns: 0, successRate: 0, avgDuration: 0, avgCost: 0, lastRunAt: null, lastError: null };
    const versions = versionCounts[w.id] || { current: 1, count: 1 };
    const workflowNotes = notes[w.id] || [];

    return {
      workflowId: w.id,
      title: w.title,
      description: w.description,
      userId: w.user_id,

      // 从 data 提取结构信息
      ...extractStructureInfo(data),

      // 执行统计
      totalRuns: stats.totalRuns,
      successRate: stats.successRate,
      averageDurationMs: stats.avgDuration,
      averageCost: stats.avgCost,
      lastRunAt: stats.lastRunAt,
      lastError: stats.lastError,

      // 版本信息
      currentVersion: versions.current,
      versionCount: versions.count,

      // 笔记和标签
      notes: workflowNotes,
      tags: extractTags(data, w.title, w.description),

      // 元数据
      createdAt: w.created_at,
      updatedAt: w.updated_at,
      published: w.published,
    };
  });
}

/** 提取工作流结构信息 */
function extractStructureInfo(data: TinyflowData): {
  nodeTypes: string[];
  nodeCount: number;
  edgeCount: number;
  hasCondition: boolean;
  hasLoop: boolean;
  hasLLM: boolean;
  hasHTTP: boolean;
  hasKnowledge: boolean;
} {
  const nodes = data.nodes || [];
  const nodeTypes = [...new Set(nodes.map(n => n.type))];

  return {
    nodeTypes,
    nodeCount: nodes.length,
    edgeCount: (data.edges || []).length,
    hasCondition: nodeTypes.includes('conditionNode'),
    hasLoop: nodeTypes.includes('loopNode'),
    hasLLM: nodeTypes.includes('llmNode'),
    hasHTTP: nodeTypes.includes('httpNode'),
    hasKnowledge: nodeTypes.includes('knowledgeNode'),
  };
}

/** 自动提取标签 */
function extractTags(data: TinyflowData, title: string, description: string | null): string[] {
  const tags = new Set<string>();

  // 从节点类型提取
  const nodeTypes = data.nodes?.map(n => n.type) || [];
  if (nodeTypes.includes('llmNode')) tags.add('ai');
  if (nodeTypes.includes('httpNode')) tags.add('api');
  if (nodeTypes.includes('knowledgeNode')) tags.add('knowledge');
  if (nodeTypes.includes('searchEngineNode')) tags.add('search');
  if (nodeTypes.includes('excelNode')) tags.add('export');
  if (nodeTypes.includes('loopNode')) tags.add('batch');
  if (nodeTypes.includes('conditionNode')) tags.add('conditional');

  // 从标题和描述提取关键词
  const text = `${title} ${description || ''}`.toLowerCase();
  const keywords = ['客服', '分析', '报告', '搜索', '总结', '翻译', '生成', '处理', '监控', '通知'];
  keywords.forEach(kw => {
    if (text.includes(kw)) tags.add(kw);
  });

  return Array.from(tags);
}

// ===== 2. 执行统计查询 =====

async function getRunStats(workflowIds: string[]): Promise<Record<string, {
  totalRuns: number;
  successRate: number;
  avgDuration: number;
  avgCost: number;
  lastRunAt: string | null;
  lastError: string | null;
}>> {
  if (workflowIds.length === 0) return {};

  const { data: runs } = await supabase
    .from('flow_runs')
    .select('workflow_id, status, duration_ms, cost, error, created_at')
    .in('workflow_id', workflowIds)
    .order('created_at', { ascending: false });

  if (!runs) return {};

  // 按 workflow_id 分组统计
  const stats: Record<string, {
    totalRuns: number;
    successes: number;
    totalDuration: number;
    totalCost: number;
    lastRunAt: string | null;
    lastError: string | null;
  }> = {};

  for (const run of runs) {
    const wid = run.workflow_id;
    if (!stats[wid]) {
      stats[wid] = { totalRuns: 0, successes: 0, totalDuration: 0, totalCost: 0, lastRunAt: null, lastError: null };
    }
    const s = stats[wid];
    s.totalRuns++;
    if (run.status === 'completed') s.successes++;
    s.totalDuration += run.duration_ms || 0;
    s.totalCost += run.cost || 0;
    if (!s.lastRunAt) s.lastRunAt = run.created_at;
    if (!s.lastError && run.error) s.lastError = run.error;
  }

  // 转换为返回格式
  const result: Record<string, {
    totalRuns: number;
    successRate: number;
    avgDuration: number;
    avgCost: number;
    lastRunAt: string | null;
    lastError: string | null;
  }> = {};
  for (const [wid, s] of Object.entries(stats)) {
    result[wid] = {
      totalRuns: s.totalRuns,
      successRate: s.totalRuns > 0 ? s.successes / s.totalRuns : 0,
      avgDuration: s.totalRuns > 0 ? s.totalDuration / s.totalRuns : 0,
      avgCost: s.totalRuns > 0 ? s.totalCost / s.totalRuns : 0,
      lastRunAt: s.lastRunAt,
      lastError: s.lastError,
    };
  }
  return result;
}

async function getVersionCounts(workflowIds: string[]): Promise<Record<string, { current: number; count: number }>> {
  if (workflowIds.length === 0) return {};

  const { data: versions } = await supabase
    .from('workflow_versions')
    .select('workflow_id, version')
    .in('workflow_id', workflowIds)
    .order('version', { ascending: false });

  if (!versions) return {};

  const counts: Record<string, { current: number; count: number }> = {};
  for (const v of versions) {
    if (!counts[v.workflow_id]) {
      counts[v.workflow_id] = { current: v.version, count: 0 };
    }
    counts[v.workflow_id].count++;
  }
  return counts;
}

async function getWorkflowNotes(workflowIds: string[]): Promise<Record<string, string[]>> {
  if (workflowIds.length === 0) return {};

  const { data: notes } = await supabase
    .from('workflow_notes')
    .select('workflow_id, content')
    .in('workflow_id', workflowIds);

  if (!notes) return {};

  const result: Record<string, string[]> = {};
  for (const n of notes) {
    if (!result[n.workflow_id]) result[n.workflow_id] = [];
    result[n.workflow_id].push(n.content);
  }
  return result;
}

// ===== 3. 相似工作流检索 =====

/**
 * 检索相似工作流
 * 使用多维度匹配：标题/描述相似度 + 节点类型 + 标签 + 结构
 */
export async function findSimilarWorkflows(
  query: string,
  userId: string,
  options: {
    limit?: number;
    minScore?: number;
    excludeWorkflowId?: string;
  } = {},
): Promise<WorkflowMatch[]> {
  const { limit = 5, minScore = 0.3, excludeWorkflowId } = options;

  // 获取用户的所有工作流知识
  const allKnowledge = await indexWorkflowKnowledge(userId);

  // 过滤掉当前工作流
  const candidates = allKnowledge.filter(k => k.workflowId !== excludeWorkflowId);

  // 计算每个候选的相似度
  const matches: WorkflowMatch[] = [];
  for (const candidate of candidates) {
    const { score, reasons } = calculateSimilarity(query, candidate);
    if (score >= minScore) {
      matches.push({
        workflow: candidate,
        score,
        reasons,
        reusableNodes: extractReusableNodes(candidate),
      });
    }
  }

  // 按分数排序并返回 top N
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, limit);
}

/** 计算相似度 */
function calculateSimilarity(query: string, knowledge: WorkflowKnowledge): {
  score: number;
  reasons: MatchReason[];
} {
  const reasons: MatchReason[] = [];
  let totalScore = 0;
  let weightSum = 0;

  const queryLower = query.toLowerCase();
  const queryTokens = tokenize(queryLower);

  // 1. 标题相似度 (权重: 0.3)
  const titleScore = textSimilarity(queryTokens, tokenize(knowledge.title.toLowerCase()));
  if (titleScore > 0) {
    reasons.push({ type: 'title', score: titleScore, detail: `标题匹配: ${knowledge.title}` });
  }
  totalScore += titleScore * 0.3;
  weightSum += 0.3;

  // 2. 描述相似度 (权重: 0.2)
  if (knowledge.description) {
    const descScore = textSimilarity(queryTokens, tokenize(knowledge.description.toLowerCase()));
    if (descScore > 0) {
      reasons.push({ type: 'description', score: descScore, detail: `描述匹配` });
    }
    totalScore += descScore * 0.2;
  }
  weightSum += 0.2;

  // 3. 标签匹配 (权重: 0.25)
  const tagScore = tagMatchScore(queryTokens, knowledge.tags);
  if (tagScore > 0) {
    reasons.push({ type: 'tag', score: tagScore, detail: `标签匹配: ${knowledge.tags.join(', ')}` });
  }
  totalScore += tagScore * 0.25;
  weightSum += 0.25;

  // 4. 节点类型匹配 (权重: 0.15)
  const nodeTypeScore = nodeTypeMatchScore(query, knowledge.nodeTypes);
  if (nodeTypeScore > 0) {
    reasons.push({ type: 'node_type', score: nodeTypeScore, detail: `节点类型: ${knowledge.nodeTypes.join(', ')}` });
  }
  totalScore += nodeTypeScore * 0.15;
  weightSum += 0.15;

  // 5. 结构复杂度匹配 (权重: 0.1)
  const structScore = structureMatchScore(query, knowledge);
  if (structScore > 0) {
    reasons.push({ type: 'structure', score: structScore, detail: `结构匹配` });
  }
  totalScore += structScore * 0.1;
  weightSum += 0.1;

  // 归一化分数
  const score = weightSum > 0 ? totalScore / weightSum : 0;

  return { score, reasons };
}

/** 简单分词 */
function tokenize(text: string): string[] {
  // 中英文混合分词
  return text
    .replace(/[^\w\u4e00-\u9fff]+/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0);
}

/** 文本相似度（基于 token 重叠） */
function textSimilarity(tokens1: string[], tokens2: string[]): number {
  if (tokens1.length === 0 || tokens2.length === 0) return 0;

  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);
  let overlap = 0;

  for (const t of set1) {
    if (set2.has(t)) overlap++;
  }

  // Jaccard 相似度
  const union = set1.size + set2.size - overlap;
  return union > 0 ? overlap / union : 0;
}

/** 标签匹配分数 */
function tagMatchScore(queryTokens: string[], tags: string[]): number {
  if (tags.length === 0) return 0;

  let matches = 0;
  for (const tag of tags) {
    if (queryTokens.some(t => t.includes(tag) || tag.includes(t))) {
      matches++;
    }
  }
  return matches / tags.length;
}

/** 节点类型匹配分数 */
function nodeTypeMatchScore(query: string, nodeTypes: string[]): number {
  const nodeKeywords: Record<string, string[]> = {
    llmNode: ['ai', 'llm', '大模型', '生成', '总结', '翻译', '分析'],
    httpNode: ['api', 'http', '请求', '接口', '调用'],
    knowledgeNode: ['知识', '检索', '文档', 'search'],
    searchEngineNode: ['搜索', 'search', 'web', '网络'],
    excelNode: ['excel', '导出', '表格', '下载'],
    codeNode: ['代码', 'code', '处理', '计算'],
    loopNode: ['循环', '批量', '遍历', 'batch'],
    conditionNode: ['条件', '判断', '分支', 'if'],
  };

  const queryLower = query.toLowerCase();
  let matches = 0;
  let total = 0;

  for (const nodeType of nodeTypes) {
    const keywords = nodeKeywords[nodeType] || [];
    if (keywords.length > 0) {
      total++;
      if (keywords.some(kw => queryLower.includes(kw))) {
        matches++;
      }
    }
  }

  return total > 0 ? matches / total : 0;
}

/** 结构复杂度匹配 */
function structureMatchScore(query: string, knowledge: WorkflowKnowledge): number {
  const queryLower = query.toLowerCase();

  // 检测复杂度需求
  const wantsSimple = ['简单', '基础', '快速', 'simple', 'basic'].some(k => queryLower.includes(k));
  const wantsComplex = ['复杂', '高级', '完整', 'complex', 'advanced', 'full'].some(k => queryLower.includes(k));

  if (!wantsSimple && !wantsComplex) return 0.5; // 无偏好

  const isSimple = knowledge.nodeCount <= 3;
  const isComplex = knowledge.nodeCount > 5;

  if (wantsSimple && isSimple) return 1;
  if (wantsComplex && isComplex) return 1;
  if (wantsSimple && isComplex) return 0.2;
  if (wantsComplex && isSimple) return 0.2;

  return 0.5;
}

/** 提取可复用节点 */
function extractReusableNodes(knowledge: WorkflowKnowledge): ReusableNode[] {
  // 这里只返回节点类型信息，实际配置需要从数据库获取
  // 简化实现：返回节点类型和成功率
  return knowledge.nodeTypes
    .filter(type => !['startNode', 'endNode'].includes(type))
    .map(type => ({
      nodeId: `${knowledge.workflowId}-${type}`,
      nodeType: type,
      title: `${type} (from ${knowledge.title})`,
      description: `来自工作流 "${knowledge.title}" 的 ${type} 节点`,
      config: {}, // 实际配置需要从 workflow data 提取
      successRate: knowledge.successRate,
      averageDurationMs: knowledge.averageDurationMs / knowledge.nodeCount,
    }));
}

// ===== 4. 工作流经验提取 =====

/**
 * 提取工作流经验
 * 从执行历史、笔记、版本变更中学习
 */
export async function extractExperience(
  workflowId: string,
  userId: string,
): Promise<WorkflowExperience | null> {
  // 获取工作流知识
  const knowledgeList = await indexWorkflowKnowledge(userId, workflowId);
  if (knowledgeList.length === 0) return null;

  const knowledge = knowledgeList[0];

  // 获取执行历史
  const { data: runs } = await supabase
    .from('flow_runs')
    .select('status, error, trace, duration_ms, cost')
    .eq('workflow_id', workflowId)
    .order('created_at', { ascending: false })
    .limit(20);

  // 获取版本历史
  const { data: versions } = await supabase
    .from('workflow_versions')
    .select('version, title, description, created_at')
    .eq('workflow_id', workflowId)
    .order('version', { ascending: false })
    .limit(10);

  // 分析成功模式
  const whatWorked: string[] = [];
  if (knowledge.successRate > 0.8) {
    whatWorked.push(`高成功率 (${(knowledge.successRate * 100).toFixed(0)}%)`);
  }
  if (knowledge.averageDurationMs < 10000) {
    whatWorked.push('执行速度快');
  }
  if (knowledge.nodeCount <= 5) {
    whatWorked.push('结构简洁');
  }

  // 分析失败教训
  const whatFailed: string[] = [];
  const errors: string[] = runs?.filter((r: { error: string | null }) => r.error).map((r: { error: string | null }) => r.error as string) || [];
  if (errors.length > 0) {
    const uniqueErrors: string[] = [...new Set(errors)].slice(0, 3);
    whatFailed.push(...uniqueErrors.map((e: string) => `曾出现错误: ${e.slice(0, 100)}`));
  }
  if (knowledge.successRate < 0.5) {
    whatFailed.push('成功率较低，需要优化');
  }

  // 提取优化建议
  const optimizations: string[] = [];
  if (knowledge.hasLoop && knowledge.averageDurationMs > 30000) {
    optimizations.push('循环节点执行时间较长，考虑优化循环逻辑');
  }
  if (knowledge.averageCost > 0.1) {
    optimizations.push('成本较高，考虑使用更经济的模型');
  }

  // 最佳实践
  const bestPractices: string[] = [];
  if (knowledge.versionCount > 3) {
    bestPractices.push('经过多次迭代优化');
  }
  if (knowledge.notes.length > 0) {
    bestPractices.push('有详细的设计笔记');
  }

  return {
    workflowId,
    title: knowledge.title,
    whatWorked,
    whatFailed,
    optimizations,
    bestPractices,
  };
}

// ===== 5. 可复用模式发现 =====

/**
 * 发现可复用的工作流模式
 */
export async function findReusablePatterns(
  userId: string,
  options: { limit?: number } = {},
): Promise<ReusablePattern[]> {
  const { limit = 5 } = options;
  const allKnowledge = await indexWorkflowKnowledge(userId);

  // 按节点类型序列分组
  const patternMap = new Map<string, {
    count: number;
    successRateSum: number;
    examples: Array<{ workflowId: string; title: string }>;
  }>();

  for (const k of allKnowledge) {
    // 提取核心模式（去掉 start/end）
    const coreTypes = k.nodeTypes.filter(t => !['startNode', 'endNode'].includes(t));
    const patternKey = coreTypes.join('→');

    if (!patternMap.has(patternKey)) {
      patternMap.set(patternKey, { count: 0, successRateSum: 0, examples: [] });
    }
    const pattern = patternMap.get(patternKey)!;
    pattern.count++;
    pattern.successRateSum += k.successRate;
    if (pattern.examples.length < 3) {
      pattern.examples.push({ workflowId: k.workflowId, title: k.title });
    }
  }

  // 转换为结果
  const patterns: ReusablePattern[] = [];
  for (const [patternKey, data] of patternMap.entries()) {
    if (data.count < 2) continue; // 至少出现两次才算模式

    patterns.push({
      name: getPatternName(patternKey),
      description: `包含 ${patternKey} 的工作流模式`,
      nodeSequence: patternKey.split('→'),
      example: {
        workflowId: data.examples[0].workflowId,
        title: data.examples[0].title,
        snippet: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }, // 简化
      },
      successRate: data.successRateSum / data.count,
      usageCount: data.count,
    });
  }

  // 按使用次数排序
  patterns.sort((a, b) => b.usageCount - a.usageCount);
  return patterns.slice(0, limit);
}

/** 获取模式名称 */
function getPatternName(patternKey: string): string {
  const names: Record<string, string> = {
    'llmNode': 'AI 生成流程',
    'httpNode→llmNode': 'API 数据分析流程',
    'searchEngineNode→llmNode': '搜索总结流程',
    'llmNode→excelNode': 'AI 生成报告流程',
    'knowledgeNode→llmNode': '知识库问答流程',
  };
  return names[patternKey] || `自定义 ${patternKey} 流程`;
}

// ===== 6. AI 上下文构建 =====

/**
 * 构建 AI 上下文
 * 将工作流知识组装成给 AI 的提示词
 */
export async function buildKnowledgeContext(
  query: string,
  userId: string,
  options: {
    maxExamples?: number;
    currentWorkflow?: TinyflowData;
  } = {},
): Promise<string> {
  const { maxExamples = 3, currentWorkflow } = options;

  // 1. 查找相似工作流
  const similar = await findSimilarWorkflows(query, userId, {
    limit: maxExamples,
    excludeWorkflowId: undefined,
  });

  // 2. 发现可复用模式
  const patterns = await findReusablePatterns(userId, { limit: 3 });

  // 3. 组装上下文
  const sections: string[] = [];

  if (similar.length > 0) {
    sections.push('## 相似工作流参考');
    for (const match of similar) {
      const w = match.workflow;
      sections.push(`### ${w.title} (相似度: ${(match.score * 100).toFixed(0)}%)`);
      if (w.description) sections.push(`描述: ${w.description}`);
      sections.push(`节点类型: ${w.nodeTypes.join(', ')}`);
      sections.push(`成功率: ${(w.successRate * 100).toFixed(0)}%, 执行次数: ${w.totalRuns}`);
      if (w.notes.length > 0) {
        sections.push(`笔记: ${w.notes[0].slice(0, 200)}`);
      }
      if (match.reusableNodes.length > 0) {
        sections.push(`可复用节点: ${match.reusableNodes.map(n => n.nodeType).join(', ')}`);
      }
      sections.push('');
    }
  }

  if (patterns.length > 0) {
    sections.push('## 常用工作流模式');
    for (const p of patterns) {
      sections.push(`- **${p.name}**: ${p.description} (使用 ${p.usageCount} 次, 成功率 ${(p.successRate * 100).toFixed(0)}%)`);
    }
    sections.push('');
  }

  // 提取可复用节点建议
  if (similar.length > 0) {
    const suggestedNodes = extractSuggestedNodes(similar);
    if (suggestedNodes.length > 0) {
      sections.push('## 建议复用的节点配置');
      for (const node of suggestedNodes.slice(0, 5)) {
        sections.push(`- **${node.nodeType}** (来自 "${node.source.title}"): ${node.reason}`);
      }
      sections.push('');
    }
  }

  return sections.join('\n');
}

/** 提取建议的节点 */
function extractSuggestedNodes(matches: WorkflowMatch[]): SuggestedNode[] {
  const nodes: SuggestedNode[] = [];

  for (const match of matches) {
    for (const node of match.reusableNodes) {
      if (node.successRate > 0.7) { // 只推荐成功率高的节点
        nodes.push({
          nodeType: node.nodeType,
          reason: `成功率 ${(node.successRate * 100).toFixed(0)}%`,
          config: node.config,
          source: {
            workflowId: match.workflow.workflowId,
            title: match.workflow.title,
          },
        });
      }
    }
  }

  return nodes;
}

// ===== 7. 查询接口 =====

/**
 * 查询工作流知识
 */
export async function queryKnowledge(params: KnowledgeQuery): Promise<WorkflowKnowledge[]> {
  let allKnowledge = await indexWorkflowKnowledge(params.userId);

  // 应用过滤条件
  if (params.query) {
    const queryLower = params.query.toLowerCase();
    allKnowledge = allKnowledge.filter(k =>
      k.title.toLowerCase().includes(queryLower) ||
      k.description?.toLowerCase().includes(queryLower) ||
      k.tags.some(t => queryLower.includes(t))
    );
  }

  if (params.nodeTypes && params.nodeTypes.length > 0) {
    allKnowledge = allKnowledge.filter(k =>
      params.nodeTypes!.some(nt => k.nodeTypes.includes(nt))
    );
  }

  if (params.tags && params.tags.length > 0) {
    allKnowledge = allKnowledge.filter(k =>
      params.tags!.some(t => k.tags.includes(t))
    );
  }

  if (params.minSuccessRate !== undefined) {
    allKnowledge = allKnowledge.filter(k => k.successRate >= params.minSuccessRate!);
  }

  if (params.published !== undefined) {
    allKnowledge = allKnowledge.filter(k => k.published === params.published);
  }

  // 排序
  switch (params.sortBy) {
    case 'success_rate':
      allKnowledge.sort((a, b) => b.successRate - a.successRate);
      break;
    case 'runs':
      allKnowledge.sort((a, b) => b.totalRuns - a.totalRuns);
      break;
    case 'recent':
      allKnowledge.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      break;
    default: // relevance - 保持原顺序
      break;
  }

  // 分页
  const offset = params.offset || 0;
  const limit = params.limit || 20;
  return allKnowledge.slice(offset, offset + limit);
}
