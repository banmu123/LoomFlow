import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { updateGoal, deleteGoal, listJourneys } from '@/lib/growth/growth-service';

export const runtime = 'nodejs';

// Goal 详情（GET 含 Journeys）/ 编辑（PATCH）/ 删除（DELETE，级联）
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const { id } = await params;
  const journeys = await listJourneys(id, user.id);
  return Response.json({ goalId: id, journeys });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const result = await updateGoal(id, user.id, {
    title: body?.title,
    description: body?.description,
    status: body?.status,
  });
  if (result.error) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json(result.goal);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const { id } = await params;
  const result = await deleteGoal(id, user.id);
  if (result.error) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json({ success: true });
}
