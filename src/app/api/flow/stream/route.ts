import { NextRequest } from 'next/server';
import { FlowEngine, flowRunStore } from '@/lib/tinyflow';
import type { TinyflowData, FlowError } from '@/lib/tinyflow/types';
import { getCurrentUser } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  // 强制登录（安全：未认证可执行任意 flowData = RCE/SSRF/成本滥用入口）
  const user = await getCurrentUser();
  if (!user) {
    return new Response(JSON.stringify({ error: '未登录，请先登录' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        const body = await request.json();
        const { flowData, inputs = {} } = body as {
          flowData: TinyflowData;
          inputs?: Record<string, unknown>;
        };

        if (!flowData || !flowData.nodes) {
          send('error', { error: 'flowData is required' });
          controller.close();
          return;
        }

        const flowId = crypto.randomUUID();

        const engine = new FlowEngine(flowData, {
          flowData,
          inputs,
          onNodeStart: (nodeId: string) => {
            send('node_start', { flowId, nodeId });
          },
          onNodeComplete: (nodeId: string, result) => {
            send('node_complete', {
              flowId,
              nodeId,
              status: result.status,
              outputs: result.outputs,
              error: result.error,
              duration: result.duration,
            });
          },
          onFlowComplete: (outputs) => {
            send('flow_complete', { flowId, outputs });
          },
          onFlowError: (error) => {
            send('flow_error', { flowId, error: error.message });
          },
        });

        flowRunStore.create(flowId, {
          flowId,
          engine,
          status: 'running',
          context: engine.getContext(),
          userId: user.id,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        send('flow_start', { flowId });

        try {
          await engine.run();
          flowRunStore.update(flowId, { status: 'completed' });
        } catch (err) {
          const error = err as FlowError;
          if (error.code === 'confirm_required' && error.confirmRequest) {
            flowRunStore.update(flowId, {
              status: 'paused',
              confirmRequest: error.confirmRequest,
              context: engine.getContext(),
            });
            send('flow_paused', {
              flowId,
              confirmRequest: error.confirmRequest,
            });
          } else {
            flowRunStore.update(flowId, { status: 'failed' });
            send('flow_error', { flowId, error: error.message });
          }
        }

        send('flow_end', { flowId });
      } catch (err) {
        const error = err as Error;
        send('error', { error: error.message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Transfer-Encoding': 'chunked',
    },
  });
}
