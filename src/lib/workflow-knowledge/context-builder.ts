/**
 * Workflow Knowledge - AI Context Builder
 *
 * 扩展现有的 Copilot Context，集成工作流知识
 */

import type { TinyflowData } from '../tinyflow/types';
import type { CopilotContext, CopilotTask, ContextSources } from '../workflow-copilot/context';
import { buildCopilotContext, contextToPrompt } from '../workflow-copilot/context';
import { buildKnowledgeContext, findSimilarWorkflows, extractExperience } from './service';
import type { KnowledgeContextOptions, KnowledgeContext } from './types';

/**
 * 增强版 Copilot Context
 * 在原有基础上添加工作流知识
 */
export interface EnhancedCopilotContext extends CopilotContext {
  /** 工作流知识上下文 */
  knowledge?: string;
  /** 相似工作流数量 */
  similarCount?: number;
}

/**
 * 构建增强版 Copilot Context
 * 当 task 为 'create' 时，自动检索相似工作流
 */
export async function buildEnhancedCopilotContext(
  task: CopilotTask,
  workflowId: string | undefined,
  sources: ContextSources,
  userId: string,
  options: {
    query?: string;
    enableKnowledge?: boolean;
  } = {},
): Promise<EnhancedCopilotContext> {
  // 构建基础上下文
  const baseCtx = buildCopilotContext(task, workflowId, sources);

  // 如果未启用知识或没有用户 ID，返回基础上下文
  if (!options.enableKnowledge || !userId) {
    return baseCtx;
  }

  // 根据 task 类型决定是否加载知识
  const shouldLoadKnowledge = task === 'create' || task === 'modify' || task === 'optimize';

  if (!shouldLoadKnowledge) {
    return baseCtx;
  }

  try {
    // 构建查询
    const query = options.query || buildQueryFromContext(task, sources);

    // 获取工作流知识上下文
    const knowledgePrompt = await buildKnowledgeContext(query, userId, {
      maxExamples: 3,
      currentWorkflow: sources.workflow,
    });

    return {
      ...baseCtx,
      knowledge: knowledgePrompt,
      similarCount: (knowledgePrompt.match(/###/g) || []).length,
    };
  } catch (error) {
    console.error('[KnowledgeContext] Failed to build knowledge context:', error);
    return baseCtx;
  }
}

/** 从上下文构建查询 */
function buildQueryFromContext(task: CopilotTask, sources: ContextSources): string {
  const parts: string[] = [];

  // 从工作流提取
  if (sources.workflow) {
    const nodeTypes = sources.workflow.nodes?.map(n => n.type) || [];
    parts.push(`节点类型: ${nodeTypes.join(', ')}`);
  }

  // 从笔记提取
  if (sources.notes) {
    parts.push(sources.notes.slice(0, 200));
  }

  // 从错误日志提取
  if (sources.errorLogs && sources.errorLogs.length > 0) {
    parts.push(`错误: ${JSON.stringify(sources.errorLogs[0]).slice(0, 100)}`);
  }

  return parts.join(' ') || `${task} workflow`;
}

/**
 * 将增强上下文渲染为提示词
 */
export function enhancedContextToPrompt(ctx: EnhancedCopilotContext): string {
  const basePrompt = contextToPrompt(ctx);

  if (!ctx.knowledge) {
    return basePrompt;
  }

  return `${basePrompt}

---

# 工作流知识库参考

以下是与当前任务相似的历史工作流，可以参考它们的设计和经验：

${ctx.knowledge}

---

请参考以上历史工作流的经验来帮助用户。如果发现相似的工作流，可以建议用户复用或参考其中的节点配置。`;
}

/**
 * 构建完整知识上下文（用于独立的知识检索 API）
 */
export async function buildFullKnowledgeContext(
  options: KnowledgeContextOptions,
  userId: string,
): Promise<KnowledgeContext> {
  const { query, maxExamples = 5, currentWorkflow } = options;

  // 1. 查找相似工作流
  const similarWorkflows = await findSimilarWorkflows(query, userId, {
    limit: maxExamples,
  });

  // 2. 提取经验
  const experiences = [];
  for (const match of similarWorkflows.slice(0, 3)) {
    const exp = await extractExperience(match.workflow.workflowId, userId);
    if (exp) experiences.push(exp);
  }

  // 3. 构建提示词
  const prompt = await buildKnowledgeContext(query, userId, {
    maxExamples,
    currentWorkflow,
  });

  return {
    similarWorkflows,
    experiences,
    reusablePatterns: [], // 可以扩展
    suggestedNodes: [], // 可以扩展
    prompt,
  };
}
