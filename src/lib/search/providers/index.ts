import { searchProviderRegistry } from '../registry';
import type { SearchProvider, SearchProviderDefinition } from '../capabilities';
import { TavilyProvider } from './tavily';
import { ExaProvider } from './exa';
import { GoogleProvider } from './google';

// ===== 内置 Search Provider 类型 =====
// 注册工厂到全局 registry（扩展 provider 只需在此新增类型 + 实现 SearchProvider 接口）

/** 内置支持的 provider 类型（管理后台下拉） */
export const SEARCH_PROVIDER_TYPES = ['tavily', 'exa', 'google'] as const;

export type BuiltinSearchProviderType = (typeof SEARCH_PROVIDER_TYPES)[number];

export function isBuiltinSearchProviderType(type: string): type is BuiltinSearchProviderType {
  return (SEARCH_PROVIDER_TYPES as readonly string[]).includes(type);
}

// 注册内置类型（模块加载即注册，与 nodeRegistry 内置节点注册方式一致）
searchProviderRegistry.registerType('tavily', (def) => new TavilyProvider(def));
searchProviderRegistry.registerType('exa', (def) => new ExaProvider(def));
searchProviderRegistry.registerType('google', (def) => new GoogleProvider(def));

/** 按配置创建 provider 实例（统一入口；未注册类型抛明确错误） */
export function createSearchProvider(def: SearchProviderDefinition): SearchProvider {
  return searchProviderRegistry.create(def);
}
