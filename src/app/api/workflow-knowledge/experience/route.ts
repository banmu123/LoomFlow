/**
 * GET /api/workflow-knowledge/experience?workflowId=xxx
 * 提取工作流经验
 */

import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { extractExperience } from '@/lib/workflow-knowledge';

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const workflowId = searchParams.get('workflowId');

  if (!workflowId) {
    return Response.json({ error: 'workflowId 不能为空' }, { status: 400 });
  }

  try {
    const experience = await extractExperience(workflowId, user.id);

    if (!experience) {
      return Response.json({ error: '未找到工作流' }, { status: 404 });
    }

    return Response.json(experience);
  } catch (error) {
    console.error('[Experience API] Error:', error);
    return Response.json({ error: '提取经验失败' }, { status: 500 });
  }
}
