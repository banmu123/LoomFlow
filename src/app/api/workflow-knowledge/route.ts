/**
 * Workflow Knowledge API
 *
 * GET /api/workflow-knowledge - 查询工作流知识
 * POST /api/workflow-knowledge/search - 搜索相似工作流
 * POST /api/workflow-knowledge/context - 构建 AI 上下文
 */

import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import {
  queryKnowledge,
  findSimilarWorkflows,
  buildKnowledgeContext,
  extractExperience,
  findReusablePatterns,
} from '@/lib/workflow-knowledge';

/**
 * GET /api/workflow-knowledge
 * 查询工作流知识列表
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  const result = await queryKnowledge({
    userId: user.id,
    query: searchParams.get('query') || undefined,
    nodeTypes: searchParams.get('nodeTypes')?.split(','),
    tags: searchParams.get('tags')?.split(','),
    minSuccessRate: searchParams.get('minSuccessRate') ? Number(searchParams.get('minSuccessRate')) : undefined,
    published: searchParams.get('published') ? searchParams.get('published') === 'true' : undefined,
    limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : 20,
    offset: searchParams.get('offset') ? Number(searchParams.get('offset')) : 0,
    sortBy: (searchParams.get('sortBy') as 'relevance' | 'success_rate' | 'runs' | 'recent') || 'relevance',
  });

  return Response.json(result);
}

/**
 * POST /api/workflow-knowledge/search
 * 搜索相似工作流
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.query) {
    return Response.json({ error: 'query 不能为空' }, { status: 400 });
  }

  const { query, limit = 5, excludeWorkflowId } = body;

  const matches = await findSimilarWorkflows(query, user.id, {
    limit,
    excludeWorkflowId,
  });

  return Response.json(matches);
}
