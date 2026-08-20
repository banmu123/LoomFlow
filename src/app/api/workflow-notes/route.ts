import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import {
  createWorkflowNote,
  listWorkflowNotes,
  ensureWorkflowOwnership,
} from '@/lib/workflow-notes';

export const runtime = 'nodejs';

// Brew Notes：列表（GET?workflowId=）/ 创建（POST）
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const workflowId = request.nextUrl.searchParams.get('workflowId');
  if (!workflowId) {
    return Response.json({ error: '缺少 workflowId' }, { status: 400 });
  }
  const ownership = await ensureWorkflowOwnership(workflowId, user.id);
  if (!ownership.ok) {
    return Response.json({ error: ownership.error }, { status: 403 });
  }
  const notes = await listWorkflowNotes(workflowId, user.id);
  return Response.json(notes);
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const workflowId = (body?.workflowId || '').trim();
  if (!workflowId) {
    return Response.json({ error: '缺少 workflowId' }, { status: 400 });
  }
  const result = await createWorkflowNote(workflowId, user.id, {
    type: body?.type || 'general',
    content: body?.content || '',
    version: typeof body?.version === 'number' ? body.version : null,
  });
  if (result.error) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json(result.note, { status: 201 });
}
