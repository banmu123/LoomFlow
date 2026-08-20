import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import {
  updateJourney,
  deleteJourney,
  replaceJourneyCapabilities,
} from '@/lib/growth/growth-service';

export const runtime = 'nodejs';

// Journey：编辑（PATCH）/ 删除（DELETE，级联 capabilities）/ 整体替换阶段（PUT）
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

  // 带 capabilities 时：先更新基本信息，再整体替换阶段（重新生成场景）
  if (Array.isArray(body?.capabilities)) {
    const base = await updateJourney(id, user.id, {
      title: body?.title,
      description: body?.description,
      status: body?.status,
    });
    if (base.error) return Response.json({ error: base.error }, { status: 400 });
    const caps = await replaceJourneyCapabilities(id, user.id, body.capabilities);
    if (caps.error) return Response.json({ error: caps.error }, { status: 400 });
    return Response.json({ ...base.journey, capabilities: caps.capabilities });
  }

  const result = await updateJourney(id, user.id, {
    title: body?.title,
    description: body?.description,
    status: body?.status,
  });
  if (result.error) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json(result.journey);
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
  const result = await deleteJourney(id, user.id);
  if (result.error) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json({ success: true });
}
