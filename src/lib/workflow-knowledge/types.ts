/**
 * Workflow Knowledge Service - Types
 *
 * LoomFlow 的 Workflow Intelligence Layer
 * 让 AI 能理解用户的历史工作流经验，辅助生成新的 Workflow
 */

import type { TinyflowData } from '../tinyflow/types';

// ===== 核心数据结构 =====

/** 工作流知识条目（从多个表聚合） */
export interface WorkflowKnowledge {
  workflowId: string;
  title: string;
  description: string | null;
  userId: string;

  // 工作流结构
  nodeTypes: string[];           // 使用的节点类型列表
  nodeCount: number;             // 节点数量
  edgeCount: number;             // 边数量
  hasCondition: boolean;         // 是否有条件分支
  hasLoop: boolean;               // 是否有循环
  hasLLM: boolean;               // 是否使用 LLM
  hasHTTP: boolean;              // 是否有 HTTP 请求
  hasKnowledge: boolean;         // 是否有知识库检索

  // 执行统计
  totalRuns: number;             // 总执行次数
  successRate: number;           // 成功率 (0-1)
  averageDurationMs: number;     // 平均执行时间
  averageCost: number;           // 平均成本
  lastRunAt: string | null;      // 最后执行时间
  lastError: string | null;      // 最后错误信息

  // 版本信息
  currentVersion: number;        // 当前版本号
  versionCount: number;          // 版本总数

  // 笔记和标签
  notes: string[];               // 工作流笔记
  tags: string[];                // 自动提取的标签

  // 元数据
  createdAt: string;
  updatedAt: string;
  published: boolean;
}

/** 工作流相似度匹配结果 */
export interface WorkflowMatch {
  workflow: WorkflowKnowledge;
  score: number;                 // 相似度分数 (0-1)
  reasons: MatchReason[];        // 匹配原因
  reusableNodes: ReusableNode[]; // 可复用的节点
}

/** 匹配原因 */
export interface MatchReason {
  type: 'title' | 'description' | 'node_type' | 'tag' | 'structure' | 'note';
  score: number;
  detail: string;
}

/** 可复用节点 */
export interface ReusableNode {
  nodeId: string;
  nodeType: string;
  title: string;
  description: string;
  config: Record<string, unknown>;
  successRate: number;           // 该节点的历史成功率
  averageDurationMs: number;     // 该节点的平均执行时间
}

/** 工作流经验摘要 */
export interface WorkflowExperience {
  workflowId: string;
  title: string;
  whatWorked: string[];          // 成功的模式
  whatFailed: string[];          // 失败的教训
  optimizations: string[];       // 优化建议
  bestPractices: string[];       // 最佳实践
}

// ===== 查询参数 =====

/** 工作流知识查询参数 */
export interface KnowledgeQuery {
  userId: string;

  // 搜索条件
  query?: string;                // 自由文本搜索
  nodeTypes?: string[];          // 包含的节点类型
  tags?: string[];               // 标签过滤
  minSuccessRate?: number;       // 最小成功率
  published?: boolean;           // 是否已发布

  // 分页
  limit?: number;
  offset?: number;

  // 排序
  sortBy?: 'relevance' | 'success_rate' | 'runs' | 'recent';
}

/** AI 上下文构建参数 */
export interface KnowledgeContextOptions {
  task: 'create' | 'modify' | 'optimize';
  query: string;                 // 用户需求描述
  currentWorkflow?: TinyflowData; // 当前工作流（修改/优化时）
  maxExamples?: number;          // 最多返回几个示例
  includeExecutionHistory?: boolean;
  includeNotes?: boolean;
  includeOptimizations?: boolean;
}

/** AI 上下文结果 */
export interface KnowledgeContext {
  similarWorkflows: WorkflowMatch[];
  experiences: WorkflowExperience[];
  reusablePatterns: ReusablePattern[];
  suggestedNodes: SuggestedNode[];
  prompt: string;                // 组装好的提示词
}

/** 可复用模式 */
export interface ReusablePattern {
  name: string;
  description: string;
  nodeSequence: string[];        // 节点类型序列
  example: {
    workflowId: string;
    title: string;
    snippet: TinyflowData;       // 部分工作流片段
  };
  successRate: number;
  usageCount: number;
}

/** 建议的节点 */
export interface SuggestedNode {
  nodeType: string;
  reason: string;
  config: Record<string, unknown>;
  source: {
    workflowId: string;
    title: string;
  };
}
