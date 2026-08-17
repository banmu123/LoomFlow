import { NextRequest, NextResponse } from 'next/server';
import { flowRunStore } from '@/lib/tinyflow';
import { saveFlowRun } from '@/lib/tinyflow/runFlow';
import type { FlowError } from '@/lib/tinyflow/types';
import { getCurrentUser } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  // 强制登录 + 归属校验（安全：未认证可向任意暂停流程注入 confirmData）
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { flowId, confirmData = {} } = body as {
      flowId: string;
      confirmData?: Record<string, unknown>;
    };

    const record = flowRunStore.get(flowId);
    if (!record) {
      return NextResponse.json(
        { error: 'Flow run not found' },
        { status: 404 }
      );
    }
    if (record.userId && record.userId !== user.id && user.role !== 'admin') {
      return NextResponse.json({ error: '无权操作该流程' }, { status: 403 });
    }

    if (record.status !== 'paused') {
      return NextResponse.json(
        { error: `Flow is not paused (current status: ${record.status})` },
        { status: 400 }
      );
    }

    const events: Array<{ type: string; data: unknown; timestamp: number }> = [];

    record.engine.getParamResolver;
    // 设置回调
    type CallbackOptions = {
      onNodeStart?: (nodeId: string) => void;
      onNodeComplete?: (nodeId: string, result: unknown) => void;
      onFlowComplete?: (outputs: unknown) => void;
      onFlowError?: (error: Error) => void;
    };
    const originalOptions = (record.engine as unknown as { options: CallbackOptions }).options;
    if (originalOptions) {
      originalOptions.onNodeStart = (nodeId: string) => {
        events.push({ type: 'node_start', data: { nodeId }, timestamp: Date.now() });
      };
      originalOptions.onNodeComplete = (nodeId: string, result: unknown) => {
        events.push({ type: 'node_complete', data: { nodeId, result }, timestamp: Date.now() });
      };
      originalOptions.onFlowComplete = (outputs: unknown) => {
        events.push({ type: 'flow_complete', data: { outputs }, timestamp: Date.now() });
      };
    }

    flowRunStore.update(flowId, {
      status: 'running',
      confirmRequest: undefined,
    });

    try {
      await record.engine.resume(confirmData);
      flowRunStore.update(flowId, { status: 'completed' });
      await saveFlowRun(flowId, { status: 'completed', events });

      return NextResponse.json({
        flowId,
        status: 'completed',
        events,
      });
    } catch (err) {
      const error = err as FlowError;

      if (error.code === 'confirm_required' && error.confirmRequest) {
        flowRunStore.update(flowId, {
          status: 'paused',
          confirmRequest: error.confirmRequest,
        });
        await saveFlowRun(flowId, { status: 'paused', events });

        return NextResponse.json({
          flowId,
          status: 'paused',
          confirmRequest: error.confirmRequest,
          events,
        });
      }

      flowRunStore.update(flowId, { status: 'failed' });
      await saveFlowRun(flowId, { status: 'failed', error: error.message, events });
      return NextResponse.json(
        {
          flowId,
          status: 'failed',
          error: error.message,
          events,
        },
        { status: 500 }
      );
    }
  } catch (err) {
    const error = err as Error;
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
