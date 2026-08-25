import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { supabase } from '@/lib/supabase/server';
import { diffWorkflow, diffToMarkdown } from '@/lib/workflow-copilot/diff';
import type { TinyflowData } from '@/lib/tinyflow/types';

export const runtime = 'nodejs';

// 工作流版本 Diff：/api/workflow-copilot/diff/[from]/[to]?workflowId=xxx
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ from: string; to: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });

  const { from, to } = await params;
  const workflowId = request.nextUrl.searchParams.get('workflowId');
  if (!workflowId) return NextResponse.json({ error: 'workflowId 必填' }, { status: 400 });

  const [fromV, toV] = [Number(from), Number(to)];
  if (!Number.isFinite(fromV) || !Number.isFinite(toV)) {
    return NextResponse.json({ error: '版本号非法' }, { status: 400 });
  }

  const { data: wf } = await supabase
    .from('workflow_history')
    .select('user_id')
    .eq('id', workflowId)
    .maybeSingle();
  if (!wf) return NextResponse.json({ error: '工作流不存在' }, { status: 404 });
  if (wf.user_id !== user.id) return NextResponse.json({ error: '无权操作' }, { status: 403 });

  const { data: versions } = await supabase
    .from('workflow_versions')
    .select('version, data')
    .eq('workflow_id', workflowId)
    .in('version', [fromV, toV]);

  const map = new Map(((versions ?? []) as Array<{ version: number; data: unknown }>).map((v) => [v.version, v.data]));
  const before = (map.get(fromV) as TinyflowData) ?? { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
  const after = map.get(toV) as TinyflowData;
  if (!after) return NextResponse.json({ error: `版本 v${toV} 不存在` }, { status: 404 });

  const diff = diffWorkflow(before, after, { from: fromV, to: toV });
  return NextResponse.json({ diff, markdown: diffToMarkdown(diff) });
}
