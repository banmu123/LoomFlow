import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { updateWorkflowNote, deleteWorkflowNote } from '@/lib/workflow-notes';

export const runtime = 'nodejs';

// 编辑笔记（PATCH，仅本人）
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

  const patch: { type?: string; content?: string; version?: number | null } = {};
  if (typeof body?.type === 'string') patch.type = body.type;
  if (typeof body?.content === 'string') patch.content = body.content;
  if (body?.version !== undefined) patch.version = body.version;

  const result = await updateWorkflowNote(id, user.id, patch);
  if (result.error) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json(result.note);
}

// 删除笔记（DELETE，仅本人）
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const { id } = await params;
  const result = await deleteWorkflowNote(id, user.id);
  if (result.error) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json({ success: true });
}
