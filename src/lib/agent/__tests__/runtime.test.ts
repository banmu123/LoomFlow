import { describe, it, expect, vi } from 'vitest';
import { runAgent } from '../runtime';
import type { AgentModelCaller, AgentModelResponse, AgentTool } from '../types';

function tool(
  name: string,
  scope: AgentTool['scope'],
  execute = vi.fn(async () => ({ content: 'tool-ok' })),
): AgentTool {
  return {
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    scope,
    execute,
  };
}

function scripted(responses: AgentModelResponse[]) {
  let index = 0;
  return vi.fn(async (_input: Parameters<AgentModelCaller>[0]) => {
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return response;
  });
}

const finalAnswer = (text = 'done'): AgentModelResponse => ({
  text,
  toolCalls: [],
  totalTokens: 10,
  modelId: 'model-a',
});

const toolCall = (name: string, input: unknown = {}, id = 'call-1'): AgentModelResponse => ({
  text: '',
  toolCalls: [{ toolCallId: id, toolName: name, input }],
  totalTokens: 10,
  modelId: 'model-a',
});

describe('Agent Runtime', () => {
  it('没有工具调用时直接完成', async () => {
    const result = await runAgent(
      { goal: 'say hi', tools: [] },
      { callModel: scripted([finalAnswer('hi')]) },
    );

    expect(result.status).toBe('completed');
    expect(result.answer).toBe('hi');
    expect(result.steps).toHaveLength(1);
    expect(result.totalTokens).toBe(10);
  });

  it('多轮 Tool Calling：执行工具并把结果回传模型', async () => {
    const echo = tool('echo', 'read');
    const callModel = scripted([toolCall('echo', { q: 'hello' }), finalAnswer('final')]);

    const result = await runAgent({ goal: 'use tool', tools: [echo] }, { callModel });

    expect(result.status).toBe('completed');
    expect(result.answer).toBe('final');
    expect(echo.execute).toHaveBeenCalledWith({ q: 'hello' });
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].toolCalls[0]).toMatchObject({ name: 'echo', ok: true });

    // 第二次调用时应包含 assistant tool-call 与 tool-result 消息
    const secondCallMessages = callModel.mock.calls[1][0].messages as Array<{ role: string }>;
    expect(secondCallMessages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
  });

  it('达到最大步数时停止', async () => {
    const echo = tool('echo', 'read');
    const result = await runAgent(
      { goal: 'loop', tools: [echo], maxSteps: 2 },
      { callModel: scripted([toolCall('echo')]) },
    );

    expect(result.status).toBe('max_steps');
    expect(result.steps).toHaveLength(2);
    expect(result.stoppedReason).toBe('max_steps');
  });

  it('超出 Token 预算时停止', async () => {
    const echo = tool('echo', 'read');
    const result = await runAgent(
      { goal: 'budget', tools: [echo], tokenBudget: 15, maxSteps: 5 },
      { callModel: scripted([toolCall('echo')]) },
    );

    expect(result.status).toBe('budget_exceeded');
    expect(result.totalTokens).toBeGreaterThanOrEqual(15);
  });

  it('超出权限的工具需要审批，且不会执行', async () => {
    const write = tool('write_doc', 'write');
    const result = await runAgent(
      { goal: 'write', tools: [write], allowedScope: 'read' },
      { callModel: scripted([toolCall('write_doc', { q: 'x' })]) },
    );

    expect(result.status).toBe('approval_required');
    expect(result.pendingApproval).toMatchObject({ tool: 'write_doc', requiredScope: 'write' });
    expect(write.execute).not.toHaveBeenCalled();
  });

  it('已审批的工具可以执行', async () => {
    const write = tool('write_doc', 'write');
    const result = await runAgent(
      {
        goal: 'write',
        tools: [write],
        allowedScope: 'read',
        approvedTools: ['write_doc'],
      },
      { callModel: scripted([toolCall('write_doc'), finalAnswer('ok')]) },
    );

    expect(result.status).toBe('completed');
    expect(write.execute).toHaveBeenCalled();
  });

  it('工具抛错时把错误回传模型并继续', async () => {
    const failing = tool(
      'broken',
      'read',
      vi.fn(async () => {
        throw new Error('upstream 500');
      }),
    );
    const callModel = scripted([toolCall('broken'), finalAnswer('recovered')]);

    const result = await runAgent({ goal: 'try', tools: [failing] }, { callModel });

    expect(result.status).toBe('completed');
    expect(result.answer).toBe('recovered');
    expect(result.steps[0].toolCalls[0]).toMatchObject({ ok: false, error: 'upstream 500' });

    const toolMessage = callModel.mock.calls[1][0].messages.at(-1) as {
      content: Array<{ output: { value: string } }>;
    };
    expect(toolMessage.content[0].output.value).toContain('tool_error');
  });

  it('调用不存在的工具时回传错误而不是崩溃', async () => {
    const result = await runAgent(
      { goal: 'x', tools: [] },
      { callModel: scripted([toolCall('missing'), finalAnswer('ok')]) },
    );

    expect(result.status).toBe('completed');
    expect(result.steps[0].toolCalls[0]).toMatchObject({
      name: 'missing',
      ok: false,
      error: '工具不存在：missing',
    });
  });

  it('已取消的信号不会发起模型调用', async () => {
    const controller = new AbortController();
    controller.abort();
    const callModel = scripted([finalAnswer()]);

    const result = await runAgent(
      { goal: 'x', tools: [], signal: controller.signal },
      { callModel },
    );

    expect(result.status).toBe('cancelled');
    expect(callModel).not.toHaveBeenCalled();
  });
});
