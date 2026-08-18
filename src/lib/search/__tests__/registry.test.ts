import { describe, it, expect, vi, afterEach } from 'vitest';
import { SearchProviderRegistry, searchProviderRegistry } from '../registry';
import { createSearchProvider, SEARCH_PROVIDER_TYPES } from '../providers';
import type { SearchProvider, SearchProviderDefinition } from '../capabilities';

function makeDef(overrides: Partial<SearchProviderDefinition> = {}): SearchProviderDefinition {
  return {
    id: 'tavily-main',
    provider: 'tavily',
    apiKey: 'tvly-test',
    enabled: true,
    capabilities: ['web'],
    ...overrides,
  };
}

function makeProvider(): SearchProvider {
  return {
    type: 'fake',
    search: vi.fn(async () => ({ results: [] })),
    testConnection: vi.fn(async () => ({ ok: true, message: 'ok' })),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SearchProviderRegistry 类型注册与实例创建', () => {
  it('注册类型工厂后可创建实例', () => {
    const registry = new SearchProviderRegistry();
    registry.registerType('fake', () => makeProvider());
    expect(registry.hasType('fake')).toBe(true);
    const provider = registry.create(makeDef({ id: 'x', provider: 'fake' }));
    expect(provider.type).toBe('fake');
    expect(registry.listTypes()).toContain('fake');
  });

  it('未注册的类型创建实例抛明确错误', () => {
    const registry = new SearchProviderRegistry();
    expect(() => registry.create(makeDef({ id: 'x', provider: 'ghost' }))).toThrow(
      '未知搜索 provider 类型',
    );
  });

  it('卸载类型后不可创建', () => {
    const registry = new SearchProviderRegistry();
    registry.registerType('fake', () => makeProvider());
    registry.unregisterType('fake');
    expect(() => registry.create(makeDef({ id: 'x', provider: 'fake' }))).toThrow(
      '未知搜索 provider 类型',
    );
  });
});

describe('SearchProviderRegistry 配置查询', () => {
  it('注册/查询/删除配置定义', () => {
    const registry = new SearchProviderRegistry();
    registry.register(makeDef());
    expect(registry.get('tavily-main')).toBeDefined();
    expect(registry.list()).toHaveLength(1);
    registry.unregister('tavily-main');
    expect(registry.get('tavily-main')).toBeUndefined();
  });

  it('listEnabled 仅返回启用中的配置', () => {
    const registry = new SearchProviderRegistry();
    registry.register(makeDef({ id: 'a', enabled: true }));
    registry.register(makeDef({ id: 'b', enabled: false }));
    const enabled = registry.listEnabled();
    expect(enabled.map((d) => d.id)).toEqual(['a']);
  });

  it('createById 查询不到返回 null', () => {
    const registry = new SearchProviderRegistry();
    registry.registerType('fake', () => makeProvider());
    expect(registry.createById('ghost')).toBeNull();
    expect(registry.createById('tavily-main')).toBeNull();
  });
});

describe('全局单例 + 内置类型', () => {
  it('内置 provider 类型均已注册（模块加载副作用）', () => {
    for (const type of SEARCH_PROVIDER_TYPES) {
      expect(searchProviderRegistry.hasType(type)).toBe(true);
    }
  });

  it('createSearchProvider 工厂可创建内置类型实例', () => {
    for (const type of SEARCH_PROVIDER_TYPES) {
      const provider = createSearchProvider(makeDef({ id: `${type}-main`, provider: type }));
      expect(provider.type).toBe(type);
    }
  });

  it('未知类型工厂抛明确错误', () => {
    expect(() => createSearchProvider(makeDef({ provider: 'ghost' }))).toThrow(
      '未知搜索 provider 类型',
    );
  });
});
