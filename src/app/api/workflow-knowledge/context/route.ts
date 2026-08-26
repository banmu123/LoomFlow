/**
 * POST /api/workflow-knowledge/context
 * 构建 AI 上下文（用于 Copilot 集成）
 */

import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { buildKnowledgeContext, findReusablePatterns } from '@/lib/workflow-knowledge';

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.query) {
    return Response.json({ error: 'query 不能为空' }, { status: 400 });
  }

  const { query, maxExamples = 3 } = body;

  try {
    // 构建知识上下文
    const context = await buildKnowledgeContext(query, user.id, { maxExamples });

    // 获取可复用模式
    const patterns = await findReusablePatterns(user.id, { limit: 3 });

    return Response.json({
      context,
      patterns,
    });
  } catch (error) {
    console.error('[KnowledgeContext API] Error:', error);
    return Response.json({ error: '构建上下文失败' }, { status: 500 });
  }
}
