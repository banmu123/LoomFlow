import { NextRequest } from 'next/server';
import { WorkflowEventType } from '@coze/api';
import { createCozeClient } from '@/lib/coze-client';
import { WORKFLOW_IDS } from '@/lib/coze-workflows';

export const runtime = 'nodejs';

const MAX_MESSAGES = 20;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function extractTextFromObj(obj: Record<string, unknown>): string {
  const keys = ['operation', 'recommend', 'create', 'chatting', 'output'];
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim()) return val;
  }
  return '';
}

function extractWorkflowAndText(raw: string): { text: string; workflow?: unknown } {
  if (typeof raw !== 'string' || !raw.trim()) return { text: '' };

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { text: raw };

    const obj = parsed as Record<string, unknown>;

    // output field may contain nested JSON with tinyFlowData
    const outputVal = obj.output;

    // output is an object with tinyFlowData
    if (outputVal && typeof outputVal === 'object' && !Array.isArray(outputVal)) {
      const outputObj = outputVal as Record<string, unknown>;
      if (outputObj.tinyFlowData) {
        return {
          text: String(outputObj.chatting ?? outputObj.description ?? outputObj.text ?? outputObj.skill_name ?? ''),
          workflow: outputObj.tinyFlowData,
        };
      }
      return { text: extractTextFromObj(outputObj) };
    }

    // output is a string (may contain JSON)
    if (typeof outputVal === 'string') {
      try {
        const inner = JSON.parse(outputVal) as Record<string, unknown>;
        if (inner && typeof inner === 'object') {
          if (inner.tinyFlowData) {
            return {
              text: String(inner.chatting ?? inner.description ?? inner.text ?? inner.skill_name ?? ''),
              workflow: inner.tinyFlowData,
            };
          }
          return { text: extractTextFromObj(inner) || outputVal };
        }
      } catch {
        return { text: outputVal };
      }
    }

    // tinyFlowData at top level
    if (obj.tinyFlowData) {
      return {
        text: String(obj.chatting ?? obj.description ?? obj.text ?? obj.skill_name ?? ''),
        workflow: obj.tinyFlowData,
      };
    }

    return { text: extractTextFromObj(obj) || raw };
  } catch {
    return { text: raw };
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const messages = body?.messages as ChatMessage[] | undefined;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: 'messages 参数缺失' }, { status: 400 });
  }

  const inputStr = JSON.stringify(messages.slice(-MAX_MESSAGES));

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const apiClient = createCozeClient();
        const workflowStream = await apiClient.workflows.runs.stream({
          workflow_id: WORKFLOW_IDS.AI_CHAT,
          parameters: {
            input: inputStr,
            reportContext: '',
          },
        });

        for await (const event of workflowStream) {
          switch (event.event) {
            case WorkflowEventType.MESSAGE: {
              const rawContent =
                (event.data as { content?: string } | undefined)?.content ?? '';
              const { text, workflow } = extractWorkflowAndText(rawContent);
              if (text) send({ content: text });
              if (workflow) send({ workflow });
              break;
            }
            case WorkflowEventType.ERROR: {
              const errMsg =
                (event.data as { error_message?: string } | undefined)
                  ?.error_message ?? '工作流执行错误';
              send({ error: errMsg });
              break;
            }
            case WorkflowEventType.DONE: {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              break;
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '流读取失败';
        send({ error: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
