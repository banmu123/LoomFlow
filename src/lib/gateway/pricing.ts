import type { GatewayCost, GatewayUsage } from './types';

/**
 * 模型价格表：来自环境变量 `MODEL_PRICING_JSON`，不把价格写死在代码里。
 *
 * 格式（每 100 万 token）：
 * {
 *   "deepseek-v4-flash": { "inputPer1M": 0.14, "outputPer1M": 0.28, "currency": "USD" }
 * }
 */

export interface ModelPrice {
  inputPer1M: number;
  outputPer1M: number;
  currency: string;
}

const cache = new Map<string, Record<string, ModelPrice>>();

export function parsePricing(raw: string | undefined): Record<string, ModelPrice> {
  if (!raw || !raw.trim()) return {};
  const key = raw;
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<ModelPrice>>;
    const table: Record<string, ModelPrice> = {};
    for (const [modelId, price] of Object.entries(parsed)) {
      if (
        typeof price?.inputPer1M === 'number' &&
        typeof price.outputPer1M === 'number' &&
        Number.isFinite(price.inputPer1M) &&
        Number.isFinite(price.outputPer1M)
      ) {
        table[modelId] = {
          inputPer1M: price.inputPer1M,
          outputPer1M: price.outputPer1M,
          currency: typeof price.currency === 'string' && price.currency ? price.currency : 'USD',
        };
      }
    }
    cache.set(key, table);
    return table;
  } catch {
    // 配置写错时按"未配置价格"处理，不阻断调用
    console.warn('[gateway] MODEL_PRICING_JSON 解析失败，成本将标记为未知');
    cache.set(key, {});
    return {};
  }
}

export function priceFor(
  modelId: string,
  table: Record<string, ModelPrice>,
): ModelPrice | null {
  return table[modelId] ?? null;
}

/** 未配置价格时返回 unknown，绝不估算一个"看起来像真的"数字 */
export function estimateCost(usage: GatewayUsage, price: ModelPrice | null): GatewayCost {
  if (!price || usage.source !== 'provider') {
    return { amount: null, currency: price?.currency ?? null, known: false };
  }
  const amount =
    (usage.inputTokens / 1_000_000) * price.inputPer1M +
    (usage.outputTokens / 1_000_000) * price.outputPer1M;
  return {
    amount: Math.round(amount * 1_000_000) / 1_000_000,
    currency: price.currency,
    known: true,
  };
}
