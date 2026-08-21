import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { completePractice } from '@/lib/growth/practice-service';

export const runtime = 'nodejs';

// POST /api/growth/practices/[id]/complete
// 标记练习完成 → Practice Completed → Evidence → Capability Progress
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const { id } = await params;
  const result = await completePractice(id, user.id);
  if (result.error) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json(result.practice);
}
