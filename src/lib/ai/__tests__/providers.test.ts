import { describe, it, expect } from 'vitest';
import {
  PROVIDERS,
  resolveProvider,
  getProviderClientForModel,
} from '../providers';

describe('Provider 抽象（多模型支持）', () => {
  it('预设覆盖 OSS 常见 provider', () => {
    for (const p of ['openai', 'claude', 'gemini', 'deepseek', 'qwen', 'ollama']) {
      expect(PROVIDERS[p], `缺少预设: ${p}`).toBeTruthy();
    }
  });

  it('ollama 预设默认指向本地且无需 API Key（自部署本地模型场景）', () => {
    const resolved = resolveProvider('ollama');
    expect(resolved).not.toBeNull();
    expect(resolved?.baseURL).toBe('http://localhost:11434/v1');
    expect(resolved?.apiKey).toBe('');
  });

  it('模型级配置：有 baseURL 但无 apiKey 也能创建客户端（Ollama/本地模型）', () => {
    // 回归：此前 `baseURL && apiKey` 双条件导致无 key 模型创建失败
    const client = getProviderClientForModel({
      provider: 'ollama',
      baseURL: 'http://localhost:11434/v1',
    });
    expect(client).not.toBeNull();
  });

  it('claude provider 走 Anthropic 原生协议（非 OpenAI 兼容）', () => {
    const resolved = resolveProvider('claude');
    expect(resolved?.nativeAnthropic).toBe(true);
    // 即使未配置 baseURL 也能返回客户端（anthropic 工厂）
    const client = getProviderClientForModel({ provider: 'claude' });
    expect(client).not.toBeNull();
  });

  it('自定义 OpenAI 兼容端点照常创建', () => {
    const client = getProviderClientForModel({
      provider: 'custom',
      baseURL: 'https://my-llm.example.com/v1',
      apiKey: 'sk-test',
    });
    expect(client).not.toBeNull();
  });
});
