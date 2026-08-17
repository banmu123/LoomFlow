import { NextRequest, NextResponse } from 'next/server';
import { runFlow } from '@/lib/tinyflow/runFlow';
import type { TinyflowData } from '@/lib/tinyflow/types';
import { getCurrentUser } from '@/lib/server-auth';
import { supabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { flowData, inputs = {}, workflowId = null } = body as {
      flowData: TinyflowData;
      inputs?: Record<string, unknown>;
      workflowId?: string | null;
    };

    if (!flowData || !flowData.nodes || !flowData.edges) {
      return NextResponse.json(
        { error: 'flowData is required with nodes and edges' },
        { status: 400 },
      );
    }

    // 内部试运行：强制登录（安全：未认证可执行任意 flowData = RCE/SSRF/成本滥用入口）
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
    }

    // workflowId 关联到执行记录（flow_runs.workflow_id，供 AI 排查稳定性）；
    // 校验归属：必须属于当前用户，否则忽略（防伪造他人工作流 id）
    let safeWorkflowId: string | null = null;
    if (workflowId) {
      const { data: wf } = await supabase
        .from('workflow_history')
        .select('id')
        .eq('id', workflowId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (wf) safeWorkflowId = workflowId;
    }

    const result = await runFlow(flowData, inputs, {
      source: 'internal',
      userId: user.id,
      workflowId: safeWorkflowId,
    });

    if (result.status === 'failed') {
      return NextResponse.json(result, { status: 500 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const error = err as Error;
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 },
    );
  }
}
