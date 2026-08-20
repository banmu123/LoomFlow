import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { updateCapability } from '@/lib/growth/growth-service';

export const runtime = 'nodejs';

// Capability：更新状态/标题/描述（PATCH，仅本人）
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
  const result = await updateCapability(id, user.id, {
    title: body?.title,
    description: body?.description,
    status: body?.status,
  });
  if (result.error) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json(result.capability);
}
