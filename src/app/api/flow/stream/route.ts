import { NextRequest } from 'next/server';
import { FlowEngine, flowRunStore } from '@/lib/tinyflow';
import { saveFlowRun, extractFinalOutputs, traceToTokenUsage } from '@/lib/tinyflow/runFlow';
import { redactForTrace } from '@/lib/tinyflow/runtime/redact';
import { runStateToPersistedStatus } from '@/lib/tinyflow/runtime/state';
import type { TinyflowData, FlowError } from '@/lib/tinyflow/types';
import { getCurrentUser } from '@/lib/server-auth';
import { supabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';

// ===== 工作流试运行（SSE 流式）=====
// 与 /api/flow/execute（runFlow，阻塞式）能力对等：
// - workflowId 归属校验 + 执行记录落库（flow_runs，供执行历史/AI 排查）
// - inputs/outputs 脱敏、trace/token/cost 持久化
// 差异：事件经 SSE 逐条推送（node_start/node_complete/...），前端实时点亮执行追踪。

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
        const {
          flowData,
          inputs = {},
          workflowId = null,
          timeoutMs,
          maxConcurrency,
        } = body as {
          flowData: TinyflowData;
          inputs?: Record<string, unknown>;
          workflowId?: string | null;
          timeoutMs?: number;
          maxConcurrency?: number;
        };

        if (!flowData || !flowData.nodes) {
          send('error', { error: 'flowData is required' });
          controller.close();
          return;
        }

        // workflowId 关联执行记录：校验归属（防伪造他人工作流 id）
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

        const flowId = crypto.randomUUID();
        const startTime = Date.now();
        const events: Array<{ type: string; data: unknown; timestamp: number }> = [];

        const engine = new FlowEngine(flowData, {
          flowData,
          inputs,
          userId: user.id,
          workflowId: safeWorkflowId,
          signal: request.signal,
          timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : undefined,
          maxConcurrency: typeof maxConcurrency === 'number' ? maxConcurrency : undefined,
          onNodeStart: (nodeId: string) => {
            const ev = { type: 'node_start', data: { nodeId }, timestamp: Date.now() };
            events.push(ev);
            send('node_start', ev.data);
          },
          onNodeComplete: (nodeId: string, result) => {
            const ev = {
              type: 'node_complete',
              data: {
                nodeId,
                status: result.status,
                outputs: redactForTrace(result.outputs),
                error: result.error,
                duration: result.duration,
                attempt: result.attempt,
                retryCount: result.retryCount,
              },
              timestamp: Date.now(),
            };
            events.push(ev);
            send('node_complete', ev.data);
          },
          onFlowComplete: (outputs) => {
            const ev = {
              type: 'flow_complete',
              data: { outputs: redactForTrace(outputs) },
              timestamp: Date.now(),
            };
            events.push(ev);
            send('flow_complete', ev.data);
          },
          onFlowError: (error) => {
            const ev = { type: 'flow_error', data: { error: error.message }, timestamp: Date.now() };
            events.push(ev);
            send('flow_error', ev.data);
          },
        });

        flowRunStore.create(flowId, {
          flowId,
          engine,
          status: 'running',
          context: engine.getContext(),
          userId: user.id,
          createdAt: startTime,
          updatedAt: startTime,
        });

        // 初始落库（running）；inputs 脱敏后保存——与 runFlow 对等
        await saveFlowRun(flowId, {
          workflowId: safeWorkflowId,
          userId: user.id,
          source: 'internal',
          status: 'running',
          inputs: redactForTrace(inputs) as Record<string, unknown> | null,
          flowData: flowData,
          startTime,
        });

        send('flow_start', { flowId });

        try {
          await engine.run();
          flowRunStore.update(flowId, { status: 'completed' });

          const finalOutputs = extractFinalOutputs(flowData, engine);
          const persistedStatus = runStateToPersistedStatus(engine.getState());
          const finalTrace = engine.getTrace();

          await saveFlowRun(flowId, {
            status: persistedStatus,
            outputs: redactForTrace(finalOutputs) as Record<string, unknown> | null,
            events,
            startTime,
            finishTime: Date.now(),
            trace: finalTrace,
            tokenUsage: traceToTokenUsage(finalTrace),
            cost: finalTrace.cost,
            retryCount: finalTrace.retryCount,
          });

          send('flow_complete', { flowId, outputs: finalOutputs });
        } catch (err) {
          const error = err as FlowError;
          if (error.code === 'confirm_required' && error.confirmRequest) {
            flowRunStore.update(flowId, {
              status: 'paused',
              confirmRequest: error.confirmRequest,
              context: engine.getContext(),
            });
            await saveFlowRun(flowId, {
              status: 'paused',
              events,
              startTime,
              trace: engine.getTrace(),
            });
            send('flow_paused', {
              flowId,
              confirmRequest: error.confirmRequest,
            });
          } else {
            const persistedStatus = runStateToPersistedStatus(engine.getState());
            flowRunStore.update(flowId, { status: persistedStatus });
            const failedTrace = engine.getTrace();
            await saveFlowRun(flowId, {
              status: persistedStatus,
              error: error.message,
              events,
              startTime,
              finishTime: Date.now(),
              trace: failedTrace,
              tokenUsage: traceToTokenUsage(failedTrace),
              cost: failedTrace.cost,
              retryCount: failedTrace.retryCount,
            });
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
