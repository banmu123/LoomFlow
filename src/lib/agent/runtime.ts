import { jsonSchema } from 'ai';
import type { ModelMessage } from 'ai';
import { modelGateway } from '@/lib/gateway';
import { SCOPE_RANK, type ToolScope } from '@/lib/mcp';
import type {
  AgentModelCaller,
  AgentOptions,
  AgentResult,
  AgentStep,
  AgentStepToolCall,
  AgentTool,
} from './types';

const MAX_STEPS_LIMIT = 20;
const MAX_TOOL_OUTPUT_CHARS = 8_000;

const defaultCaller: AgentModelCaller = async (input) => {
  const result = await modelGateway.callModel({
    messages: input.messages,
    system: input.system,
    modelId: input.modelId,
    fallbackModelIds: input.fallbackModelIds,
    tools: input.tools,
    temperature: input.temperature,
    abortSignal: input.abortSignal,
  });
  return {
    text: result.text,
    toolCalls: result.toolCalls,
    totalTokens: result.usage.totalTokens,
    modelId: result.modelId,
  };
};

/** 把 AgentTool 转成 AI SDK 的工具定义（无 execute：执行权在 Runtime，便于审批与追踪） */
export function toModelTools(tools: AgentTool[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const tool of tools) {
    result[tool.name] = {
      description: tool.description,
      inputSchema: jsonSchema(tool.inputSchema as never),
    };
  }
  return result;
}

function assistantToolCallMessage(
  toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>,
): ModelMessage {
  return {
    role: 'assistant',
    content: toolCalls.map((call) => ({
      type: 'tool-call' as const,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: call.input,
    })),
  };
}

function toolResultMessage(
  results: Array<{ toolCallId: string; toolName: string; text: string }>,
): ModelMessage {
  return {
    role: 'tool',
    content: results.map((item) => ({
      type: 'tool-result' as const,
      toolCallId: item.toolCallId,
      toolName: item.toolName,
      output: { type: 'text' as const, value: item.text },
    })),
  };
}

/**
 * 受控 Agent Runtime。
 *
 * 与 Workflow 的区别：Workflow 的节点顺序是预先定义的；Agent 由模型根据目标
 * 动态决定调用哪个工具、调用几次。这里只负责"循环 + 预算 + 权限 + 追踪"，
 * 不把多次模型调用包装成所谓的自主智能。
 *
 * 审批语义：超出 allowedScope 的工具不会被执行，直接返回 approval_required
 * 与待审批调用；调用方带上 approvedTools 重新执行即可（本轮之前的工具调用会重放，
 * 因此默认 allowedScope=read，写操作必须先获批）。
 */
export async function runAgent(
  options: AgentOptions,
  deps: { callModel?: AgentModelCaller } = {},
): Promise<AgentResult> {
  const callModel = deps.callModel ?? defaultCaller;
  const maxSteps = Math.min(Math.max(options.maxSteps ?? 6, 1), MAX_STEPS_LIMIT);
  const tokenBudget = Math.max(options.tokenBudget ?? 20_000, 1);
  const allowedScope: ToolScope = options.allowedScope ?? 'read';
  const approved = new Set(options.approvedTools ?? []);
  const toolsByName = new Map(options.tools.map((tool) => [tool.name, tool]));
  const modelTools = toModelTools(options.tools);

  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 120_000, 1_000), 600_000);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;

  const messages: ModelMessage[] = [{ role: 'user', content: options.goal }];
  const steps: AgentStep[] = [];
  let totalTokens = 0;

  const stopped = (
    status: AgentResult['status'],
    answer: string,
    stoppedReason?: AgentResult['stoppedReason'],
  ): AgentResult => ({ status, answer, steps, totalTokens, stoppedReason });

  for (let index = 1; index <= maxSteps; index += 1) {
    if (signal.aborted) {
      const reason = timeoutSignal.aborted ? 'timeout' : 'cancelled';
      return stopped('cancelled', '', reason);
    }

    let response;
    try {
      response = await callModel({
        messages,
        system: options.systemPrompt,
        tools: modelTools,
        modelId: options.modelId,
        fallbackModelIds: options.fallbackModelIds,
        temperature: options.temperature,
        abortSignal: signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError' || signal.aborted) {
        return stopped('cancelled', '', timeoutSignal.aborted ? 'timeout' : 'cancelled');
      }
      throw err;
    }

    totalTokens += response.totalTokens;

    if (response.toolCalls.length === 0) {
      steps.push({
        index,
        modelId: response.modelId,
        text: response.text,
        toolCalls: [],
        totalTokens: response.totalTokens,
      });
      return stopped('completed', response.text);
    }

    const step: AgentStep = {
      index,
      modelId: response.modelId,
      text: response.text,
      toolCalls: [],
      totalTokens: response.totalTokens,
    };

    const results: Array<{ toolCallId: string; toolName: string; text: string }> = [];

    for (const call of response.toolCalls) {
      const tool = toolsByName.get(call.toolName);

      if (!tool) {
        const message = `工具不存在：${call.toolName}`;
        step.toolCalls.push({ name: call.toolName, arguments: call.input, ok: false, error: message });
        results.push({ toolCallId: call.toolCallId, toolName: call.toolName, text: message });
        continue;
      }

      const needsApproval =
        SCOPE_RANK[tool.scope] > SCOPE_RANK[allowedScope] && !approved.has(tool.name);

      if (needsApproval) {
        step.toolCalls.push({
          name: tool.name,
          arguments: call.input,
          ok: false,
          error: 'approval_required',
        });
        steps.push(step);
        return {
          status: 'approval_required',
          answer: response.text,
          steps,
          totalTokens,
          pendingApproval: {
            tool: tool.name,
            arguments: call.input,
            requiredScope: tool.scope,
          },
        };
      }

      const args =
        call.input && typeof call.input === 'object'
          ? (call.input as Record<string, unknown>)
          : {};

      try {
        const result = await tool.execute(args);
        const text = result.content.slice(0, MAX_TOOL_OUTPUT_CHARS);
        step.toolCalls.push({
          name: tool.name,
          arguments: call.input,
          ok: !result.isError,
          error: result.isError ? text.slice(0, 500) : undefined,
        });
        // 工具输出是外部数据：加边界标记，降低 Prompt Injection 影响
        results.push({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          text: `<tool_output tool="${tool.name}">\n${text}\n</tool_output>`,
        });
      } catch (err) {
        const message = (err as Error).message.slice(0, 500);
        step.toolCalls.push({
          name: tool.name,
          arguments: call.input,
          ok: false,
          error: message,
        });
        results.push({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          text: `<tool_error tool="${tool.name}">${message}</tool_error>`,
        });
      }
    }

    steps.push(step);

    if (totalTokens >= tokenBudget) {
      return stopped('budget_exceeded', response.text, 'token_budget');
    }

    messages.push(assistantToolCallMessage(response.toolCalls));
    messages.push(toolResultMessage(results));
  }

  return stopped('max_steps', steps[steps.length - 1]?.text ?? '', 'max_steps');
}

export type { AgentTool } from './types';
