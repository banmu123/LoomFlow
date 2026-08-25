import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { supabase } from '@/lib/supabase/server';
import { ensureWorkflowOwnership } from '@/lib/workflow-copilot/test-case-store';
import { analyzeWorkflow } from '@/lib/workflow-eval/static-analysis';
import type { TinyflowData } from '@/lib/tinyflow/types';

export const runtime = 'nodejs';

// 静态分析：执行前分析（可传 flowData 覆盖，否则取当前保存的工作流）
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
  const { id } = await params;
  const own = await ensureWorkflowOwnership(id, user.id);
  if (!own.ok) return NextResponse.json({ error: own.error }, { status: 403 });

  const body = await request.json().catch(() => null);
  let flowData: TinyflowData | null = body?.flowData ?? null;

  if (!flowData) {
    const { data } = await supabase
      .from('workflow_history')
      .select('data')
      .eq('id', id)
      .maybeSingle();
    flowData = (data?.data ?? null) as TinyflowData | null;
  }
  if (!flowData?.nodes) return NextResponse.json({ error: '工作流数据为空' }, { status: 400 });

  const result = analyzeWorkflow(flowData);
  return NextResponse.json(result);
}