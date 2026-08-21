import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { getPractice, updatePractice, deletePractice } from '@/lib/growth/practice-service';

export const runtime = 'nodejs';

// GET /api/growth/practices/[id]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const { id } = await params;
  const practice = await getPractice(id, user.id);
  if (!practice) {
    return Response.json({ error: '练习不存在' }, { status: 404 });
  }
  return Response.json(practice);
}

// PATCH /api/growth/practices/[id]
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
  const result = await updatePractice(id, user.id, {
    title: body?.title,
    description: body?.description,
    type: body?.type,
    difficulty: body?.difficulty,
    instructions: body?.instructions,
    status: body?.status,
  });
  if (result.error) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json(result.practice);
}

// DELETE /api/growth/practices/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const { id } = await params;
  const result = await deletePractice(id, user.id);
  if (result.error) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json({ ok: true });
}
