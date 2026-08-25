import { NextRequest, NextResponse } from 'next/server';
import { flowRunStore } from '@/lib/tinyflow';
import { saveFlowRun } from '@/lib/tinyflow/runFlow';
import { getCurrentUser } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  // 强制登录 + 归属校验（安全：未认证可任意终止他人流程 = DoS）
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { flowId } = body as { flowId: string };

    const record = flowRunStore.get(flowId);
    if (!record) {
      return NextResponse.json({
        flowId,
        status: 'not_found',
        message: 'Flow run not found, nothing to stop',
      });
    }
    if (record.userId && record.userId !== user.id && user.role !== 'admin') {
      return NextResponse.json({ error: '无权操作该流程' }, { status: 403 });
    }

    // 统一取消逻辑：状态置为 cancelled（不再使用语义含混的 stopped）
    record.engine.cancel();
    flowRunStore.update(flowId, { status: 'cancelled' });
    await saveFlowRun(flowId, { status: 'cancelled' });

    return NextResponse.json({
      flowId,
      status: 'cancelled',
      message: 'Flow execution has been cancelled',
    });
  } catch (err) {
    const error = err as Error;
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
