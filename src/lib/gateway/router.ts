import type { ModelCapability, ModelDefinition } from '@/lib/ai';
import type { GatewayCandidate, GatewayTaskType, RoutePreference } from './types';
import type { ModelPrice } from './pricing';

/** 任务类型 → 需要的能力。chat/summarize/extract 都是纯文本任务。 */
const TASK_CAPABILITY: Record<GatewayTaskType, ModelCapability> = {
  chat: 'text',
  summarize: 'text',
  extract: 'text',
  vision: 'vision',
  tool: 'tool',
};

export interface PlanOptions {
  models: ModelDefinition[];
  explicitModelId?: string;
  fallbackModelIds?: string[];
  requireCapabilities?: ModelCapability[];
  taskType?: GatewayTaskType;
  prefer?: RoutePreference;
  prices?: Record<string, ModelPrice>;
  exclude?: Set<string>;
  maxCandidates?: number;
}

function costOf(model: ModelDefinition, prices: Record<string, ModelPrice>): number {
  const price = prices[model.id];
  if (!price) return Number.POSITIVE_INFINITY;
  return price.inputPer1M + price.outputPer1M;
}

/**
 * 生成候选模型顺序。
 *
 * 规则（刻意保持简单，不假装是"智能路由"）：
 * 1. 用户显式指定的模型永远第一；
 * 2. 备用模型按用户给定顺序；
 * 3. 只有在用户没有指定任何模型时，才按能力/任务/成本偏好自动选一个；
 * 4. 同一模型只出现一次，候选数上限默认 3（限制请求放大）。
 *
 * 延迟偏好没有历史数据时保持注册表顺序，不编造排序依据。
 */
export function planCandidates(options: PlanOptions): GatewayCandidate[] {
  const excluded = options.exclude ?? new Set<string>();
  const byId = new Map(options.models.map((m) => [m.id, m]));

  const required = new Set<ModelCapability>(options.requireCapabilities ?? []);
  if (options.taskType) required.add(TASK_CAPABILITY[options.taskType]);

  const satisfies = (model: ModelDefinition): boolean =>
    [...required].every((cap) => model.capabilities.includes(cap));

  const result: GatewayCandidate[] = [];
  const seen = new Set<string>();

  const push = (modelId: string | undefined, origin: GatewayCandidate['origin']): void => {
    if (!modelId || seen.has(modelId) || excluded.has(modelId)) return;
    const model = byId.get(modelId);
    if (!model || !satisfies(model)) return;
    seen.add(modelId);
    result.push({ ...model, origin });
  };

  push(options.explicitModelId, 'explicit');
  for (const id of options.fallbackModelIds ?? []) push(id, 'fallback');

  // 用户显式指定了模型但它不满足能力要求：明确失败，不静默换模型
  if (options.explicitModelId && result.length === 0) {
    return [];
  }

  // 用户没有指定任何模型 → 按偏好路由
  if (result.length === 0) {
    const pool = options.models.filter((m) => satisfies(m) && !excluded.has(m.id));
    const prices = options.prices ?? {};

    if (options.prefer === 'cost') {
      pool.sort((a, b) => costOf(a, prices) - costOf(b, prices));
    }
    // latency / balanced：保留注册表顺序（没有本地延迟样本，不做伪排序）

    for (const model of pool) push(model.id, 'routed');
  }

  return result.slice(0, Math.max(1, options.maxCandidates ?? 3));
}
