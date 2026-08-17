import { NextRequest, NextResponse } from 'next/server';
import { runFlow } from '@/lib/tinyflow/runFlow';
import type { TinyflowData } from '@/lib/tinyflow/types';
import { getCurrentUser } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { flowData, inputs = {} } = body as {
      flowData: TinyflowData;
      inputs?: Record<string, unknown>;
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

    const result = await runFlow(flowData, inputs, {
      source: 'internal',
      userId: user.id,
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
