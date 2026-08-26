/**
 * Workflow Knowledge Service
 *
 * LoomFlow 的 Workflow Intelligence Layer
 * 让 AI 能理解用户的历史工作流经验，辅助生成新的 Workflow
 *
 * 核心能力：
 * 1. 索引工作流元数据（从现有表聚合，无需额外存储）
 * 2. 检索相似工作流（基于文本相似度 + 结构匹配）
 * 3. 提取工作流经验（从执行历史、笔记、版本变更）
 * 4. 发现可复用模式（自动识别常用节点组合）
 * 5. 构建 AI 上下文（集成到 Copilot）
 */

export * from './types';
export { 
  indexWorkflowKnowledge,
  findSimilarWorkflows,
  extractExperience,
  findReusablePatterns,
  buildKnowledgeContext,
  queryKnowledge,
} from './service';
export {
  buildEnhancedCopilotContext,
  enhancedContextToPrompt,
  buildFullKnowledgeContext,
} from './context-builder';
