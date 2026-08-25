/**
 * Model Pricing Abstraction（Part 五）
 *
 * 不硬编码单个模型价格：内置默认价格表，可按模型精确覆盖，后续可接入配置/数据库。
 * 所有成本计算统一走这里，避免散落 magic number。
 */

export interface ModelPrice {
  /** 输入价格：美元 / 1K tokens */
  inputPer1K: number;
  /** 输出价格：美元 / 1K tokens */
  outputPer1K: number;
}

export const DEFAULT_PRICE: ModelPrice = { inputPer1K: 0.002, outputPer1K: 0.006 };

/** 常用模型价格（美元 / 1K tokens）；未列出的走 DEFAULT_PRICE */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  'deepseek-v4-flash': { inputPer1K: 0.001, outputPer1K: 0.003 },
  'deepseek-v4-pro': { inputPer1K: 0.002, outputPer1K: 0.006 },
  'deepseek-chat': { inputPer1K: 0.00027, outputPer1K: 0.0011 },
  'deepseek-reasoner': { inputPer1K: 0.00055, outputPer1K: 0.00219 },
  'gpt-4o': { inputPer1K: 0.0025, outputPer1K: 0.01 },
  'gpt-4o-mini': { inputPer1K: 0.00015, outputPer1K: 0.0006 },
  'claude-3-5-sonnet': { inputPer1K: 0.003, outputPer1K: 0.015 },
  'claude-3-haiku': { inputPer1K: 0.00025, outputPer1K: 0.00125 },
  'moonshot-v1-32k': { inputPer1K: 0.002, outputPer1K: 0.006 },
};

/** 查询模型价格；未收录则用默认价 */
export function getModelPrice(modelId?: string | null): ModelPrice {
  if (modelId) {
    const p = MODEL_PRICES[modelId];
    if (p) return p;
    // 尝试前缀匹配（如 gpt-4o-2024-08、deepseek-v4-flash-0428）
    for (const [key, price] of Object.entries(MODEL_PRICES)) {
      if (modelId.startsWith(key)) return price;
    }
  }
  return DEFAULT_PRICE;
}

export interface TokenSplit {
  promptTokens: number;
  completionTokens: number;
}

/** 计算一次调用的估算成本（美元） */
export function estimateCallCost(
  tokens: TokenSplit,
  price: ModelPrice = DEFAULT_PRICE,
): number {
  return (
    (tokens.promptTokens / 1000) * price.inputPer1K +
    (tokens.completionTokens / 1000) * price.outputPer1K
  );
}

/** 若只知道总 token，按 2:1 拆分 prompt/completion 粗略估算 */
export function estimateCostFromTotal(
  totalTokens: number,
  modelId?: string | null,
): number {
  if (totalTokens <= 0) return 0;
  const completion = totalTokens / 3;
  const prompt = totalTokens - completion;
  return estimateCallCost({ promptTokens: prompt, completionTokens: completion }, getModelPrice(modelId));
}