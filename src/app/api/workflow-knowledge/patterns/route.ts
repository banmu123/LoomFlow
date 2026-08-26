/**
 * GET /api/workflow-knowledge/patterns
 * 发现可复用的工作流模式
 */

import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { findReusablePatterns } from '@/lib/workflow-knowledge';

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : 5;

  try {
    const patterns = await findReusablePatterns(user.id, { limit });
    return Response.json(patterns);
  } catch (error) {
    console.error('[Patterns API] Error:', error);
    return Response.json({ error: '发现模式失败' }, { status: 500 });
  }
}
