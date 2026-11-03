import { describe, it, expect, vi } from 'vitest';
import type { ModelDefinition } from '@/lib/ai';
import { createGateway } from '../gateway';
import { CircuitBreaker } from '../circuit-breaker';
import { GatewayMetrics } from '../metrics';
import { ProviderCallError, type callProvider } from '../adapter';
import type { GatewayRequest } from '../types';

const models: ModelDefinition[] = [
  { id: 'primary', provider: 'deepseek', capabilities: ['text'] },
  { id: 'backup', provider: 'openai', capabilities: ['text'] },
  { id: 'vision', provider: 'openai', capabilities: ['text', 'vision'] },
];

const baseRequest: GatewayRequest = {
  messages: [{ role: 'user', content: 'hello' }],
  modelId: 'primary',
  timeoutMs: 1000,
};

function okProvider(text = 'ok') {
  return {
    text,
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, source: 'provider' as const },
    toolCalls: [],
    finishReason: 'stop',
  };
}

function makeGateway(overrides: {
  provider?: ReturnType<typeof vi.fn>;
  now?: () => number;
  checkUrl?: (url: string) => Promise<{ ok: boolean; reason?: string }>;
  pricing?: Record<string, { inputPer1M: number; outputPer1M: number; currency: string }>;
  breaker?: CircuitBreaker;
  metrics?: GatewayMetrics;
}) {
  const provider = overrides.provider ?? vi.fn(async () => okProvider());
  const metrics = overrides.metrics ?? new GatewayMetrics();

  const gateway = createGateway({
    loadModels: async () => models,
    callProvider: provider as unknown as typeof callProvider,
    breaker: overrides.breaker ?? new CircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000 }),
    metrics,
    now: overrides.now ?? (() => 0),
    checkUrl: overrides.checkUrl ?? (async () => ({ ok: true })),
    pricing: overrides.pricing ?? {},
    allowPrivateHosts: new Set(['ollama']),
  });

  return { gateway, provider, metrics };
}

describe('Model Gateway', () => {
  it('正常调用返回文本、用量与请求 id', async () => {
    const { gateway } = makeGateway({});
    const result = await gateway.callModel({ ...baseRequest, requestId: 'req-1' });

    expect(result.text).toBe('ok');
    expect(result.modelId).toBe('primary');
    expect(result.requestId).toBe('req-1');
    expect(result.usage.totalTokens).toBe(15);
    expect(result.fallbacks).toEqual([]);
    expect(result.cost.known).toBe(false);
  });

  it('429 限流后自动切换备用模型并保留回退原因', async () => {
    const provider = vi.fn(async (input: { model: ModelDefinition }) => {
      if (input.model.id === 'primary') {
        throw new ProviderCallError('rate_limit', '429', {
          retryable: true,
          statusCode: 429,
          provider: 'deepseek',
        });
      }
      return okProvider('from-backup');
    });

    const { gateway, metrics } = makeGateway({ provider });
    const result = await gateway.callModel({
      ...baseRequest,
      fallbackModelIds: ['backup'],
    });

    expect(result.modelId).toBe('backup');
    expect(result.text).toBe('from-backup');
    expect(result.fallbacks).toHaveLength(1);
    expect(result.fallbacks[0]).toMatchObject({ modelId: 'primary', errorClass: 'rate_limit' });
    expect(metrics.snapshot().fallbackRequests).toBe(1);
  });

  it('5xx 触发降级', async () => {
    const provider = vi.fn(async (input: { model: ModelDefinition }) => {
      if (input.model.id === 'primary') {
        throw new ProviderCallError('server_error', '502', {
          retryable: true,
          statusCode: 502,
          provider: 'deepseek',
        });
      }
      return okProvider();
    });

    const { gateway } = makeGateway({ provider });
    const result = await gateway.callModel({ ...baseRequest, fallbackModelIds: ['backup'] });
    expect(result.modelId).toBe('backup');
  });

  it('鉴权类错误立即停止，不盲目重试', async () => {
    const provider = vi.fn(async () => {
      throw new ProviderCallError('config_error', '401 invalid key', {
        retryable: false,
        statusCode: 401,
        provider: 'deepseek',
      });
    });

    const { gateway } = makeGateway({ provider });

    await expect(
      gateway.callModel({ ...baseRequest, fallbackModelIds: ['backup'] }),
    ).rejects.toMatchObject({ code: 'config_error' });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('所有候选失败时保留完整尝试链路', async () => {
    const provider = vi.fn(async () => {
      throw new ProviderCallError('server_error', '503', {
        retryable: true,
        statusCode: 503,
        provider: 'deepseek',
      });
    });

    const { gateway } = makeGateway({ provider });

    await expect(
      gateway.callModel({ ...baseRequest, fallbackModelIds: ['backup'] }),
    ).rejects.toMatchObject({
      code: 'all_providers_failed',
      attempts: [
        { modelId: 'primary', errorClass: 'server_error' },
        { modelId: 'backup', errorClass: 'server_error' },
      ],
    });
  });

  it('熔断打开后直接跳过该模型，不再发请求', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 60_000 });
    const provider = vi.fn(async () => {
      throw new ProviderCallError('server_error', '500', {
        retryable: true,
        statusCode: 500,
        provider: 'deepseek',
      });
    });
    const { gateway } = makeGateway({ provider, breaker });

    await expect(gateway.callModel(baseRequest)).rejects.toMatchObject({
      code: 'all_providers_failed',
    });
    await expect(gateway.callModel(baseRequest)).rejects.toMatchObject({
      code: 'all_providers_failed',
    });
    const callsBefore = provider.mock.calls.length;

    await expect(gateway.callModel(baseRequest)).rejects.toMatchObject({
      code: 'all_providers_failed',
      attempts: [{ errorClass: 'circuit_open' }],
    });
    expect(provider.mock.calls.length).toBe(callsBefore);
  });

  it('自定义 baseURL 指向内网时拒绝调用（SSRF）', async () => {
    const provider = vi.fn(async () => okProvider());

    const gateway = createGateway({
      loadModels: async () => [
        { id: 'custom', provider: 'openai', capabilities: ['text'], baseURL: 'http://10.0.0.1/v1' },
      ],
      callProvider: provider as unknown as typeof callProvider,
      breaker: new CircuitBreaker(),
      metrics: new GatewayMetrics(),
      now: () => 0,
      checkUrl: async () => ({ ok: false, reason: '不允许访问内网/回环地址' }),
      pricing: {},
      allowPrivateHosts: new Set(['ollama']),
    });

    await expect(gateway.callModel({ ...baseRequest, modelId: 'custom' })).rejects.toMatchObject({
      code: 'config_error',
    });
    expect(provider).toHaveBeenCalledTimes(0);
  });

  it('按任务能力路由到视觉模型', async () => {
    const { gateway } = makeGateway({});
    const result = await gateway.callModel({
      messages: baseRequest.messages,
      taskType: 'vision',
    });
    expect(result.modelId).toBe('vision');
  });

  it('配置价格后计算成本，未配置则标记未知', async () => {
    const pricing = { primary: { inputPer1M: 1, outputPer1M: 2, currency: 'USD' } };
    const { gateway } = makeGateway({ pricing });

    const known = await gateway.callModel(baseRequest);
    expect(known.cost).toEqual({ amount: 0.00002, currency: 'USD', known: true });

    const { gateway: plain } = makeGateway({});
    const unknown = await plain.callModel(baseRequest);
    expect(unknown.cost.known).toBe(false);
    expect(unknown.cost.amount).toBeNull();
  });
});
