import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { anthropic } from '@ai-sdk/anthropic';

// ===== Provider 配置 =====

export interface ProviderConfig {
  id: string;
  /** API key 环境变量名（如 DEEPSEEK_API_KEY / ARK_API_KEY）；本地模型（Ollama）可无 */
  envKey?: string;
  /** baseURL 环境变量名（如 DEEPSEEK_BASE_URL / ARK_BASE_URL） */
  envBaseURL?: string;
  /** 默认 baseURL（无环境变量时） */
  defaultBaseURL?: string;
  /** 是否 Anthropic 原生协议（非 OpenAI 兼容，走 @ai-sdk/anthropic） */
  nativeAnthropic?: boolean;
}

export interface ResolvedProvider {
  id: string;
  baseURL: string;
  apiKey: string;
  nativeAnthropic?: boolean;
}

// ===== 内置 Provider 定义 =====
// 覆盖 OSS 自部署常见选择：OpenAI / Claude / Gemini / DeepSeek / Qwen / Ollama（本地模型）
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
  openai: {
    id: 'openai',
    envKey: 'OPENAI_API_KEY',
    envBaseURL: 'OPENAI_BASE_URL',
    defaultBaseURL: 'https://api.openai.com/v1',
  },
  // Claude：Anthropic 原生协议（非 OpenAI 兼容）
  claude: {
    id: 'claude',
    envKey: 'ANTHROPIC_API_KEY',
    envBaseURL: 'ANTHROPIC_BASE_URL',
    defaultBaseURL: 'https://api.anthropic.com',
    nativeAnthropic: true,
  },
  gemini: {
    id: 'gemini',
    envKey: 'GEMINI_API_KEY',
    envBaseURL: 'GEMINI_BASE_URL',
    // Google 官方 OpenAI 兼容端点
    defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  qwen: {
    id: 'qwen',
    envKey: 'QWEN_API_KEY',
    envBaseURL: 'QWEN_BASE_URL',
    defaultBaseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  // Ollama：本地模型，无需 API Key
  ollama: {
    id: 'ollama',
    envBaseURL: 'OLLAMA_BASE_URL',
    defaultBaseURL: 'http://localhost:11434/v1',
  },
};

/** 解析 provider 配置（环境变量优先） */
export function resolveProvider(id: string): ResolvedProvider | null {
  const config = PROVIDERS[id];
  if (!config) return null;
  const apiKey = (config.envKey && process.env[config.envKey]) || '';
  const baseURL =
    (config.envBaseURL && process.env[config.envBaseURL]) || config.defaultBaseURL || '';
  return {
    id: config.id,
    baseURL,
    apiKey,
    nativeAnthropic: config.nativeAnthropic,
  };
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
  if (resolved.nativeAnthropic) {
    // Claude 原生协议：anthropic 工厂即 modelId → LanguageModel
    return anthropic;
  }
  return createProviderClient(resolved);
}

/** 模型级配置优先创建客户端（baseURL/apiKey 覆盖 provider 环境变量） */
export function getProviderClientForModel(model: {
  provider: string;
  baseURL?: string;
  apiKey?: string;
}) {
  // Claude：Anthropic 原生协议（即使配了 base_url 也走 anthropic 工厂）
  if (model.provider === 'claude') {
    return anthropic;
  }
  // 有 baseURL 就按 OpenAI 兼容创建——apiKey 可空（Ollama/本地模型不需要 key）
  if (model.baseURL) {
    return createOpenAICompatible({
      baseURL: model.baseURL,
      apiKey: model.apiKey || '',
      name: model.provider,
    });
  }
  const resolved = resolveProvider(model.provider);
  if (!resolved) return null;
  if (resolved.nativeAnthropic) return anthropic;
  return createProviderClient(resolved);
}
