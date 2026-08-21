import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { listPractices, createPractice } from '@/lib/growth/practice-service';

export const runtime = 'nodejs';

// Practices：列表（GET）/ 创建（POST）
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const capabilityId = request.nextUrl.searchParams.get('capabilityId') ?? undefined;
  const practices = await listPractices(user.id, capabilityId);
  return Response.json(practices);
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const result = await createPractice(user.id, {
    title: body?.title,
    description: body?.description,
    type: body?.type,
    difficulty: body?.difficulty,
    instructions: body?.instructions,
    capability_id: body?.capability_id,
  });
  if (result.error) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json(result.practice, { status: 201 });
}
