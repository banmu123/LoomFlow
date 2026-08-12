import { describe, it, expect } from 'vitest';
import { ModelRegistry, modelRegistry, BUILTIN_MODELS } from '../index';
import { hasCapability } from '../capabilities';
import { resolveProvider, PROVIDERS } from '../providers';

describe('Model Registry', () => {
  it('内置模型已注册', () => {
    expect(modelRegistry.get('deepseek-v4-flash')).toBeDefined();
    expect(modelRegistry.get('deepseek-v4-pro')).toBeDefined();
  });

  it('自定义注册/查询/注销', () => {
    const registry = new ModelRegistry();
    registry.register({
      id: 'custom-model',
      provider: 'openai-compatible',
      capabilities: ['text', 'vision'],
    });
    expect(registry.get('custom-model')?.provider).toBe('openai-compatible');
    registry.unregister('custom-model');
    expect(registry.get('custom-model')).toBeUndefined();
  });

  it('按能力筛选模型', () => {
    const registry = new ModelRegistry([
      { id: 'a', provider: 'p1', capabilities: ['text'] },
      { id: 'b', provider: 'p2', capabilities: ['text', 'vision'] },
      { id: 'c', provider: 'p3', capabilities: ['image'] },
    ]);
    const visionModels = registry.listByCapability('vision').map((m) => m.id);
    expect(visionModels).toEqual(['b']);
    expect(registry.findWithCapability('image')?.id).toBe('c');
  });

  it('canUse 检查能力', () => {
    const registry = new ModelRegistry([
      { id: 'text-only', provider: 'p', capabilities: ['text'] },
      { id: 'vision-model', provider: 'p', capabilities: ['text', 'vision'] },
    ]);
    expect(registry.canUse('text-only', 'text')).toBe(true);
    expect(registry.canUse('text-only', 'vision')).toBe(false);
    expect(registry.canUse('vision-model', 'vision')).toBe(true);
    expect(registry.canUse('unknown', 'text')).toBe(false);
  });

  it('内置模型仅声明 text 能力（视觉预留）', () => {
    for (const m of BUILTIN_MODELS) {
      expect(hasCapability(m, 'text')).toBe(true);
      expect(hasCapability(m, 'vision')).toBe(false);
    }
  });
});

describe('Providers', () => {
  it('deepseek provider 使用 DeepSeek 端点', () => {
    const resolved = resolveProvider('deepseek');
    expect(resolved?.baseURL).toContain('api.deepseek.com');
  });

  it('未知 provider 返回 null', () => {
    expect(resolveProvider('unknown-provider')).toBeNull();
  });

  it('内置 provider 定义完整', () => {
    expect(PROVIDERS.deepseek.envKey).toBe('DEEPSEEK_API_KEY');
    expect(PROVIDERS.ark.defaultBaseURL).toContain('volces.com');
  });
});
