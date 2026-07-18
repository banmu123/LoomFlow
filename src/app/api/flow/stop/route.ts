import { NextRequest, NextResponse } from 'next/server';
import { flowRunStore } from '@/lib/tinyflow';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
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

    // 中止引擎
    record.engine.abort();
    flowRunStore.update(flowId, { status: 'stopped' });

    return NextResponse.json({
      flowId,
      status: 'stopped',
      message: 'Flow execution has been stopped',
    });
  } catch (err) {
    const error = err as Error;
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
