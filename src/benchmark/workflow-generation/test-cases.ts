/**
 * Workflow Generation Benchmark - Test Cases
 *
 * 标准化测试用例，评估 AI Workflow Generation 能力
 */

import type { TinyflowData } from '../../src/lib/tinyflow/types';

// ===== 测试用例类型定义 =====

export interface BenchmarkTestCase {
  id: string;
  category: 'simple' | 'medium' | 'complex';
  name: string;
  description: string;
  input: string;
  expected: {
    nodeTypes: string[];           // 期望的节点类型（不含 start/end）
    minNodes: number;              // 最少节点数
    maxNodes: number;              // 最多节点数
    requiredConnections: number;   // 最少连接数
    shouldHaveCondition?: boolean; // 是否应有条件分支
    shouldHaveLoop?: boolean;      // 是否应有循环
    shouldHaveLLM?: boolean;       // 是否应有 LLM 节点
    shouldHaveHTTP?: boolean;      // 是否应有 HTTP 节点
    shouldHaveSearch?: boolean;    // 是否应有搜索节点
  };
  evaluationWeights: {
    schemaValidity: number;
    nodeCorrectness: number;
    executionSuccess: number;
  };
}

// ===== Simple 测试用例 =====

export const SIMPLE_CASES: BenchmarkTestCase[] = [
  {
    id: 'simple-llm',
    category: 'simple',
    name: 'Simple LLM Workflow',
    description: '基础 AI 对话流程',
    input: '创建一个AI对话流程',
    expected: {
      nodeTypes: ['llmNode'],
      minNodes: 3,
      maxNodes: 4,
      requiredConnections: 2,
      shouldHaveLLM: true,
    },
    evaluationWeights: {
      schemaValidity: 0.4,
      nodeCorrectness: 0.3,
      executionSuccess: 0.3,
    },
  },
  {
    id: 'simple-http',
    category: 'simple',
    name: 'Simple HTTP Workflow',
    description: '调用外部 API',
    input: '调用天气API获取天气信息',
    expected: {
      nodeTypes: ['httpNode'],
      minNodes: 3,
      maxNodes: 4,
      requiredConnections: 2,
      shouldHaveHTTP: true,
    },
    evaluationWeights: {
      schemaValidity: 0.4,
      nodeCorrectness: 0.3,
      executionSuccess: 0.3,
    },
  },
  {
    id: 'simple-template',
    category: 'simple',
    name: 'Simple Template Workflow',
    description: '模板生成流程',
    input: '生成一封欢迎邮件模板',
    expected: {
      nodeTypes: ['templateNode'],
      minNodes: 3,
      maxNodes: 4,
      requiredConnections: 2,
    },
    evaluationWeights: {
      schemaValidity: 0.4,
      nodeCorrectness: 0.3,
      executionSuccess: 0.3,
    },
  },
];

// ===== Medium 测试用例 =====

export const MEDIUM_CASES: BenchmarkTestCase[] = [
  {
    id: 'medium-customer-support',
    category: 'medium',
    name: 'Customer Support System',
    description: '客服问题分类和回答系统',
    input: '创建一个客服问题分类和回答系统',
    expected: {
      nodeTypes: ['llmNode', 'conditionNode'],
      minNodes: 4,
      maxNodes: 6,
      requiredConnections: 4,
      shouldHaveCondition: true,
      shouldHaveLLM: true,
    },
    evaluationWeights: {
      schemaValidity: 0.35,
      nodeCorrectness: 0.35,
      executionSuccess: 0.3,
    },
  },
  {
    id: 'medium-research-assistant',
    category: 'medium',
    name: 'Research Assistant',
    description: '搜索资料并生成研究报告',
    input: '搜索资料并生成研究报告',
    expected: {
      nodeTypes: ['searchEngineNode', 'llmNode', 'templateNode'],
      minNodes: 4,
      maxNodes: 6,
      requiredConnections: 4,
      shouldHaveSearch: true,
      shouldHaveLLM: true,
    },
    evaluationWeights: {
      schemaValidity: 0.35,
      nodeCorrectness: 0.35,
      executionSuccess: 0.3,
    },
  },
  {
    id: 'medium-content-pipeline',
    category: 'medium',
    name: 'Content Pipeline',
    description: '文章生产流程',
    input: '生成文章生产流程',
    expected: {
      nodeTypes: ['llmNode', 'templateNode'],
      minNodes: 4,
      maxNodes: 6,
      requiredConnections: 4,
      shouldHaveLLM: true,
    },
    evaluationWeights: {
      schemaValidity: 0.35,
      nodeCorrectness: 0.35,
      executionSuccess: 0.3,
    },
  },
];

// ===== Complex 测试用例 =====

export const COMPLEX_CASES: BenchmarkTestCase[] = [
  {
    id: 'complex-data-processing',
    category: 'complex',
    name: 'Data Processing Pipeline',
    description: '批量处理数据并生成报告',
    input: '批量处理Excel数据并生成分析报告',
    expected: {
      nodeTypes: ['loopNode', 'excelNode', 'llmNode', 'templateNode'],
      minNodes: 5,
      maxNodes: 8,
      requiredConnections: 6,
      shouldHaveLoop: true,
      shouldHaveLLM: true,
    },
    evaluationWeights: {
      schemaValidity: 0.3,
      nodeCorrectness: 0.4,
      executionSuccess: 0.3,
    },
  },
  {
    id: 'complex-multi-source',
    category: 'complex',
    name: 'Multi-source Research',
    description: '多来源搜索综合分析',
    input: '从多个来源搜索信息并进行综合分析',
    expected: {
      nodeTypes: ['searchEngineNode', 'llmNode', 'codeNode'],
      minNodes: 5,
      maxNodes: 8,
      requiredConnections: 6,
      shouldHaveSearch: true,
      shouldHaveLLM: true,
    },
    evaluationWeights: {
      schemaValidity: 0.3,
      nodeCorrectness: 0.4,
      executionSuccess: 0.3,
    },
  },
  {
    id: 'complex-customer-feedback',
    category: 'complex',
    name: 'Customer Feedback Analysis',
    description: '客户反馈分析与改进建议',
    input: '分析客户反馈并生成改进建议',
    expected: {
      nodeTypes: ['llmNode', 'conditionNode'],
      minNodes: 5,
      maxNodes: 8,
      requiredConnections: 6,
      shouldHaveCondition: true,
      shouldHaveLLM: true,
    },
    evaluationWeights: {
      schemaValidity: 0.3,
      nodeCorrectness: 0.4,
      executionSuccess: 0.3,
    },
  },
];

// ===== 所有测试用例 =====

export const ALL_CASES: BenchmarkTestCase[] = [
  ...SIMPLE_CASES,
  ...MEDIUM_CASES,
  ...COMPLEX_CASES,
];

// ===== 辅助函数 =====

/** 按类别获取测试用例 */
export function getCasesByCategory(category: 'simple' | 'medium' | 'complex'): BenchmarkTestCase[] {
  switch (category) {
    case 'simple': return SIMPLE_CASES;
    case 'medium': return MEDIUM_CASES;
    case 'complex': return COMPLEX_CASES;
    default: return ALL_CASES;
  }
}

/** 获取测试用例 */
export function getTestCase(id: string): BenchmarkTestCase | undefined {
  return ALL_CASES.find(c => c.id === id);
}
