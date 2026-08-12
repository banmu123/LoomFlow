import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

// ===== Provider 配置 =====

export interface ProviderConfig {
  id: string;
  /** API key 环境变量名（如 DEEPSEEK_API_KEY / ARK_API_KEY） */
  envKey?: string;
  /** baseURL 环境变量名（如 DEEPSEEK_BASE_URL / ARK_BASE_URL） */
  envBaseURL?: string;
  /** 默认 baseURL（无环境变量时） */
  defaultBaseURL?: string;
}

export interface ResolvedProvider {
  id: string;
  baseURL: string;
  apiKey: string;
}

// ===== 内置 Provider 定义 =====

export const PROVIDERS: Record<string, ProviderConfig> = {
  deepseek: {
    id: 'deepseek',
    envKey: 'DEEPSEEK_API_KEY',
    envBaseURL: 'DEEPSEEK_BASE_URL',
    defaultBaseURL: 'https://api.deepseek.com/v1',
  },
  ark: {
    id: 'ark',
    envKey: 'ARK_API_KEY',
    envBaseURL: 'ARK_BASE_URL',
    defaultBaseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  },
};

/** 解析 provider 配置（环境变量优先） */
export function resolveProvider(id: string): ResolvedProvider | null {
  const config = PROVIDERS[id];
  if (!config) return null;
  const apiKey = (config.envKey && process.env[config.envKey]) || '';
  const baseURL =
    (config.envBaseURL && process.env[config.envBaseURL]) || config.defaultBaseURL || '';
  return { id: config.id, baseURL, apiKey };
}

/** 创建 OpenAI 兼容实例 */
export function createProviderClient(provider: ResolvedProvider) {
  return createOpenAICompatible({
    baseURL: provider.baseURL,
    apiKey: provider.apiKey,
    name: provider.id,
  });
}

/** 按 provider id 创建客户端（未配置 key 也返回，调用时才会失败） */
export function getProviderClient(id: string) {
  const resolved = resolveProvider(id);
  if (!resolved) return null;
  return createProviderClient(resolved);
}
