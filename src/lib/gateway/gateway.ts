import { randomUUID } from 'node:crypto';
import type { ModelDefinition } from '@/lib/ai';
import { getAllModels } from '@/lib/ai/db-models';
import { isSafeHttpUrl } from '@/lib/url-security';
import { recordModelCall, withSpan } from '@/lib/telemetry';
import { callProvider, ProviderCallError } from './adapter';
import { CircuitBreaker } from './circuit-breaker';
import { gatewayMetrics, GatewayMetrics } from './metrics';
import { estimateCost, parsePricing, priceFor, type ModelPrice } from './pricing';
import { planCandidates } from './router';
import {
  GatewayError,
  type FallbackAttempt,
  type GatewayRequest,
  type GatewayResult,
  type GatewayUsage,
} from './types';

export interface GatewayDeps {
  loadModels: () => Promise<ModelDefinition[]>;
  callProvider: typeof callProvider;
  breaker: CircuitBreaker;
  metrics: GatewayMetrics;
  now: () => number;
  checkUrl: (url: string) => Promise<{ ok: boolean; reason?: string }>;
  pricing: Record<string, ModelPrice>;
  allowPrivateHosts: Set<string>;
}

function defaultAllowPrivateHosts(): Set<string> {
  const raw = process.env.MODEL_ALLOW_PRIVATE_HOSTS ?? 'ollama';
  return new Set(
    raw
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

function defaultDeps(): GatewayDeps {
  return {
    loadModels: getAllModels,
    callProvider,
    breaker: new CircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 }),
    metrics: gatewayMetrics,
    now: () => Date.now(),
    checkUrl: isSafeHttpUrl,
    pricing: parsePricing(process.env.MODEL_PRICING_JSON),
    allowPrivateHosts: defaultAllowPrivateHosts(),
  };
}

function timeoutSignal(
  timeoutMs: number,
  external?: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
  const timer = AbortSignal.timeout(timeoutMs);
  if (!external) return { signal: timer, dispose: () => {} };
  return {
    signal: AbortSignal.any([external, timer]),
    dispose: () => {},
  };
}

/**
 * 统一模型网关。
 *
 * 重试策略（刻意保守，避免请求放大）：
 * - 每个候选模型只调用一次，不在同一 provider 内部重试；
 * - 429 / 5xx / 超时 / 网络错误 → 切到下一个候选；
 * - 401/403/404/400 → 立即停止并保留原始错误（重试无意义）；
 * - 熔断打开的候选直接跳过，不发起请求。
 */
export function createGateway(overrides: Partial<GatewayDeps> = {}) {
  const deps: GatewayDeps = { ...defaultDeps(), ...overrides };

  async function callModel(request: GatewayRequest): Promise<GatewayResult> {
    const requestId = request.requestId ?? randomUUID();
    const startedAt = deps.now();

    if (request.abortSignal?.aborted) {
      throw new GatewayError('cancelled', '模型调用已取消');
    }

    const models = await deps.loadModels();
    const candidates = planCandidates({
      models,
      explicitModelId: request.modelId,
      fallbackModelIds: request.fallbackModelIds,
      requireCapabilities: request.requireCapabilities,
      taskType: request.taskType,
      prefer: request.prefer,
      prices: deps.pricing,
    });

    if (candidates.length === 0) {
      throw new GatewayError(
        'no_model_available',
        '没有可用模型：请先在「模型配置」中添加模型，或检查能力要求是否过严',
      );
    }

    const attempts: FallbackAttempt[] = [];
    const timeoutMs = Math.min(Math.max(request.timeoutMs ?? 60_000, 1_000), 300_000);

    for (const candidate of candidates) {
      const breakerKey = `${candidate.provider}:${candidate.id}`;

      if (!deps.breaker.canAttempt(breakerKey, deps.now())) {
        attempts.push({
          modelId: candidate.id,
          provider: candidate.provider,
          errorClass: 'circuit_open',
          retryable: true,
          latencyMs: 0,
        });
        continue;
      }

      // 自定义 baseURL 的 SSRF 校验：禁止指向内网（本地模型 provider 需显式放行）
      if (candidate.baseURL && !deps.allowPrivateHosts.has(candidate.provider.toLowerCase())) {
        const check = await deps.checkUrl(candidate.baseURL);
        if (!check.ok) {
          attempts.push({
            modelId: candidate.id,
            provider: candidate.provider,
            errorClass: 'unsafe_base_url',
            retryable: false,
            latencyMs: 0,
          });
          throw new GatewayError(
            'config_error',
            `模型 ${candidate.id} 的 baseURL 不安全：${check.reason ?? '不允许访问内网地址'}`,
            { attempts },
          );
        }
      }

      const attemptStart = deps.now();
      const { signal } = timeoutSignal(timeoutMs, request.abortSignal);

      try {
        const response = await withSpan(
          'gen_ai.chat',
          {
            'gen_ai.request.model': candidate.id,
            'gen_ai.provider.name': candidate.provider,
            'gen_ai.request.fallback': attempts.length > 0,
          },
          () =>
            deps.callProvider({
              model: candidate,
              messages: request.messages,
              system: request.system,
              temperature: request.temperature,
              maxOutputTokens: request.maxOutputTokens,
              tools: request.tools,
              abortSignal: signal,
            }),
        );

        const latencyMs = deps.now() - attemptStart;
        const usage: GatewayUsage = response.usage;
        const cost = estimateCost(usage, priceFor(candidate.id, deps.pricing));

        deps.breaker.recordSuccess(breakerKey);
        recordModelCall({
          modelId: candidate.id,
          provider: candidate.provider,
          success: true,
          durationMs: latencyMs,
          fallbackUsed: attempts.length > 0,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cost: cost.amount,
        });
        deps.metrics.record({
          modelId: candidate.id,
          provider: candidate.provider,
          success: true,
          latencyMs,
          fallbackUsed: attempts.length > 0,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costAmount: cost.amount,
          costKnown: cost.known,
        });

        return {
          text: response.text,
          modelId: candidate.id,
          provider: candidate.provider,
          usage,
          cost,
          latencyMs,
          requestId,
          fallbacks: attempts,
          toolCalls: response.toolCalls,
          finishReason: response.finishReason,
        };
      } catch (err) {
        const latencyMs = deps.now() - attemptStart;
        const mapped =
          err instanceof ProviderCallError
            ? err
            : new ProviderCallError('provider_error', (err as Error).message, {
                retryable: true,
                provider: candidate.provider,
                cause: err,
              });

        attempts.push({
          modelId: candidate.id,
          provider: candidate.provider,
          errorClass: mapped.errorClass,
          retryable: mapped.retryable,
          latencyMs,
          statusCode: mapped.statusCode,
        });

        if (mapped.retryable) {
          deps.breaker.recordFailure(breakerKey, deps.now());
        }

        if (!mapped.retryable) {
          deps.metrics.record({
            modelId: candidate.id,
            provider: candidate.provider,
            success: false,
            latencyMs: deps.now() - startedAt,
            fallbackUsed: attempts.length > 1,
            inputTokens: 0,
            outputTokens: 0,
            costAmount: null,
            costKnown: false,
          });
          throw new GatewayError('config_error', mapped.message, { attempts, cause: mapped });
        }
      }
    }

    deps.metrics.record({
      modelId: candidates[0]?.id ?? 'unknown',
      provider: candidates[0]?.provider ?? 'unknown',
      success: false,
      latencyMs: deps.now() - startedAt,
      fallbackUsed: attempts.length > 1,
      inputTokens: 0,
      outputTokens: 0,
      costAmount: null,
      costKnown: false,
    });

    const detail = attempts.map((a) => `${a.modelId}(${a.errorClass})`).join(', ');
    throw new GatewayError('all_providers_failed', `所有候选模型均失败：${detail}`, {
      attempts,
    });
  }

  return { callModel, deps };
}

/** 全局默认网关（LLM 节点使用） */
export const modelGateway = createGateway();
