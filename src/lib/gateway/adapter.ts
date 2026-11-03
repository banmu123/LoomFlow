import { generateText } from 'ai';
import type { ModelMessage, ToolSet } from 'ai';
import { getProviderClientForModel, type ModelDefinition } from '@/lib/ai';
import type { GatewayToolCall, GatewayUsage } from './types';

export type ProviderErrorClass =
  | 'rate_limit'
  | 'server_error'
  | 'timeout'
  | 'config_error'
  | 'provider_error'
  | 'cancelled';

export class ProviderCallError extends Error {
  readonly errorClass: ProviderErrorClass;
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly provider: string;

  constructor(
    errorClass: ProviderErrorClass,
    message: string,
    options: { retryable: boolean; statusCode?: number; provider: string; cause?: unknown },
  ) {
    super(message);
    this.name = 'ProviderCallError';
    this.errorClass = errorClass;
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
    this.provider = options.provider;
    this.cause = options.cause;
  }
}

export interface AdapterInput {
  model: ModelDefinition;
  messages: ModelMessage[];
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
  tools?: Record<string, unknown>;
  abortSignal?: AbortSignal;
}

export interface AdapterResult {
  text: string;
  usage: GatewayUsage;
  toolCalls: GatewayToolCall[];
  finishReason: string;
}

interface RawUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
}

function extractUsage(raw: RawUsage | undefined): GatewayUsage {
  const inputTokens = raw?.inputTokens ?? raw?.promptTokens;
  const outputTokens = raw?.outputTokens ?? raw?.completionTokens;
  const provided =
    inputTokens !== undefined || outputTokens !== undefined || raw?.totalTokens !== undefined;

  const input = Number(inputTokens ?? 0);
  const output = Number(outputTokens ?? 0);

  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: Number(raw?.totalTokens ?? input + output),
    source: provided ? 'provider' : 'unknown',
  };
}

function mapError(err: unknown, provider: string): ProviderCallError {
  if (err instanceof ProviderCallError) return err;

  const error = err as {
    name?: string;
    message?: string;
    statusCode?: number;
    isRetryable?: boolean;
    cause?: { statusCode?: number; code?: string };
  };

  const statusCode = error.statusCode ?? error.cause?.statusCode;
  const message = error.message || String(err);
  const name = error.name ?? '';

  if (name === 'AbortError' || name === 'TimeoutError') {
    return new ProviderCallError('timeout', `模型调用超时：${message}`, {
      retryable: true,
      provider,
      cause: err,
    });
  }
  if (statusCode === 429) {
    return new ProviderCallError('rate_limit', `模型限流（429）：${message}`, {
      retryable: true,
      statusCode,
      provider,
      cause: err,
    });
  }
  if (statusCode !== undefined && statusCode >= 500) {
    return new ProviderCallError('server_error', `模型服务异常（${statusCode}）：${message}`, {
      retryable: true,
      statusCode,
      provider,
      cause: err,
    });
  }
  if (statusCode === 401 || statusCode === 403 || statusCode === 404 || statusCode === 400) {
    return new ProviderCallError('config_error', `模型配置错误（${statusCode}）：${message}`, {
      retryable: false,
      statusCode,
      provider,
      cause: err,
    });
  }

  // 网络抖动等：可重试，但只切到下一个候选，不在同一 provider 反复重试
  return new ProviderCallError('provider_error', message, {
    retryable: error.isRetryable !== false,
    statusCode,
    provider,
    cause: err,
  });
}

/** 单次 provider 调用（不做重试；重试由网关决定是否切换候选） */
export async function callProvider(input: AdapterInput): Promise<AdapterResult> {
  const provider = input.model.provider;
  const client = getProviderClientForModel(input.model);
  if (!client) {
    throw new ProviderCallError('config_error', `未知 provider：${provider}`, {
      retryable: false,
      provider,
    });
  }

  try {
    const result = await generateText({
      model: client(input.model.id),
      messages: input.messages,
      system: input.system,
      temperature: input.temperature,
      maxOutputTokens: input.maxOutputTokens,
      tools: input.tools as ToolSet | undefined,
      abortSignal: input.abortSignal,
    });

    return {
      text: result.text,
      usage: extractUsage(result.usage as RawUsage | undefined),
      toolCalls: (result.toolCalls ?? []).map((call) => ({
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
      })),
      finishReason: String(result.finishReason ?? 'unknown'),
    };
  } catch (err) {
    throw mapError(err, provider);
  }
}
