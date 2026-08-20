import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { createJourney } from '@/lib/growth/growth-service';

export const runtime = 'nodejs';

// Journeys：创建（POST，可携带 capabilities 一并创建）
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const goalId = (body?.goalId || '').trim();
  if (!goalId) return Response.json({ error: '缺少 goalId' }, { status: 400 });

  const result = await createJourney(goalId, user.id, {
    title: body?.title,
    description: body?.description,
    capabilities: body?.capabilities,
  });
  if (result.error) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json(result.journey, { status: 201 });
}
