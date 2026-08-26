/**
 * Mock Workflow Generator
 *
 * 用于 benchmark 测试的模拟生成器
 * 实际使用时替换为真正的 AI 生成逻辑
 */

import type { TinyflowData, NodeData } from '../../lib/tinyflow/types';

/**
 * 创建默认 NodeData
 */
function createNodeData(title: string, extra: Partial<NodeData> = {}): NodeData {
  return {
    title,
    description: '',
    condition: '',
    loopEnable: false,
    loopIntervalMs: '',
    maxLoopCount: '',
    loopBreakCondition: '',
    retryEnable: false,
    retryIntervalMs: '',
    maxRetryCount: '',
    resetRetryCountAfterNormal: false,
    ...extra,
  };
}

/**
 * Mock 生成器：根据输入生成工作流
 * 这是一个简化版本，用于测试 benchmark 框架
 */
export function createMockGenerator(): (input: string) => Promise<{
  workflow: TinyflowData | null;
  tokens: number;
  cost: number;
}> {
  return async (input: string) => {
    // 模拟 token 消耗
    const tokens = Math.round(input.length * 2 + 1000);
    const cost = tokens * 0.000002;

    // 根据输入生成不同的工作流
    const workflow = generateMockWorkflow(input);

    return { workflow, tokens, cost };
  };
}

/**
 * 根据输入生成 mock 工作流
 */
function generateMockWorkflow(input: string): TinyflowData {
  const inputLower = input.toLowerCase();

  // 简单 LLM 流程
  if (inputLower.includes('ai') || inputLower.includes('对话') || inputLower.includes('聊天')) {
    return {
      nodes: [
        { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: createNodeData('开始') },
        { id: 'llm', type: 'llmNode', position: { x: 200, y: 0 }, data: createNodeData('AI处理', { llmId: 'deepseek-v4-flash' }) },
        { id: 'end', type: 'endNode', position: { x: 400, y: 0 }, data: createNodeData('结束') },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'llm' },
        { id: 'e2', source: 'llm', target: 'end' },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
  }

  // HTTP 流程
  if (inputLower.includes('api') || inputLower.includes('http') || inputLower.includes('天气')) {
    return {
      nodes: [
        { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: createNodeData('开始') },
        { id: 'http', type: 'httpNode', position: { x: 200, y: 0 }, data: createNodeData('调用API', { method: 'GET', url: 'https://api.example.com' }) },
        { id: 'end', type: 'endNode', position: { x: 400, y: 0 }, data: createNodeData('结束') },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'http' },
        { id: 'e2', source: 'http', target: 'end' },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
  }

  // 搜索 + 总结流程
  if (inputLower.includes('搜索') || inputLower.includes('研究') || inputLower.includes('报告')) {
    return {
      nodes: [
        { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: createNodeData('开始') },
        { id: 'search', type: 'searchEngineNode', position: { x: 200, y: 0 }, data: createNodeData('搜索资料') },
        { id: 'llm', type: 'llmNode', position: { x: 400, y: 0 }, data: createNodeData('生成报告', { llmId: 'deepseek-v4-flash' }) },
        { id: 'template', type: 'templateNode', position: { x: 600, y: 0 }, data: createNodeData('格式化输出') },
        { id: 'end', type: 'endNode', position: { x: 800, y: 0 }, data: createNodeData('结束') },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'search' },
        { id: 'e2', source: 'search', target: 'llm' },
        { id: 'e3', source: 'llm', target: 'template' },
        { id: 'e4', source: 'template', target: 'end' },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
  }

  // 客服流程（带条件分支）
  if (inputLower.includes('客服') || inputLower.includes('分类') || inputLower.includes('支持')) {
    return {
      nodes: [
        { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: createNodeData('开始') },
        { id: 'classify', type: 'llmNode', position: { x: 200, y: 0 }, data: createNodeData('问题分类', { llmId: 'deepseek-v4-flash' }) },
        { id: 'condition', type: 'conditionNode', position: { x: 400, y: 0 }, data: createNodeData('判断类型') },
        { id: 'answer', type: 'llmNode', position: { x: 600, y: -50 }, data: createNodeData('生成回答', { llmId: 'deepseek-v4-flash' }) },
        { id: 'transfer', type: 'templateNode', position: { x: 600, y: 50 }, data: createNodeData('转人工') },
        { id: 'end', type: 'endNode', position: { x: 800, y: 0 }, data: createNodeData('结束') },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'classify' },
        { id: 'e2', source: 'classify', target: 'condition' },
        { id: 'e3', source: 'condition', target: 'answer', data: { sourcePort: 'true' } },
        { id: 'e4', source: 'condition', target: 'transfer', data: { sourcePort: 'false' } },
        { id: 'e5', source: 'answer', target: 'end' },
        { id: 'e6', source: 'transfer', target: 'end' },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
  }

  // 文章生成流程
  if (inputLower.includes('文章') || inputLower.includes('内容') || inputLower.includes('生成')) {
    return {
      nodes: [
        { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: createNodeData('开始') },
        { id: 'outline', type: 'llmNode', position: { x: 200, y: 0 }, data: createNodeData('生成大纲', { llmId: 'deepseek-v4-flash' }) },
        { id: 'content', type: 'llmNode', position: { x: 400, y: 0 }, data: createNodeData('生成内容', { llmId: 'deepseek-v4-flash' }) },
        { id: 'format', type: 'templateNode', position: { x: 600, y: 0 }, data: createNodeData('格式化') },
        { id: 'end', type: 'endNode', position: { x: 800, y: 0 }, data: createNodeData('结束') },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'outline' },
        { id: 'e2', source: 'outline', target: 'content' },
        { id: 'e3', source: 'content', target: 'format' },
        { id: 'e4', source: 'format', target: 'end' },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
  }

  // Excel 数据处理
  if (inputLower.includes('excel') || inputLower.includes('数据') || inputLower.includes('批量')) {
    return {
      nodes: [
        { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: createNodeData('开始') },
        { id: 'loop', type: 'loopNode', position: { x: 200, y: 0 }, data: createNodeData('遍历数据') },
        { id: 'process', type: 'codeNode', position: { x: 400, y: 0 }, data: createNodeData('处理数据') },
        { id: 'llm', type: 'llmNode', position: { x: 600, y: 0 }, data: createNodeData('生成分析', { llmId: 'deepseek-v4-flash' }) },
        { id: 'excel', type: 'excelNode', position: { x: 800, y: 0 }, data: createNodeData('导出Excel') },
        { id: 'end', type: 'endNode', position: { x: 1000, y: 0 }, data: createNodeData('结束') },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'loop' },
        { id: 'e2', source: 'loop', target: 'process' },
        { id: 'e3', source: 'process', target: 'llm' },
        { id: 'e4', source: 'llm', target: 'excel' },
        { id: 'e5', source: 'excel', target: 'end' },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
  }

  // 默认：简单 LLM 流程
  return {
    nodes: [
      { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: createNodeData('开始') },
      { id: 'llm', type: 'llmNode', position: { x: 200, y: 0 }, data: createNodeData('处理', { llmId: 'deepseek-v4-flash' }) },
      { id: 'end', type: 'endNode', position: { x: 400, y: 0 }, data: createNodeData('结束') },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'llm' },
      { id: 'e2', source: 'llm', target: 'end' },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}
