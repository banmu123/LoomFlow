import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { listGoals, createGoal } from '@/lib/growth/growth-service';

export const runtime = 'nodejs';

// Goals：列表（GET）/ 创建（POST）
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const goals = await listGoals(user.id);
  return Response.json(goals);
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const result = await createGoal(user.id, {
    title: body?.title,
    description: body?.description,
    status: body?.status,
  });
  if (result.error) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json(result.goal, { status: 201 });
}
