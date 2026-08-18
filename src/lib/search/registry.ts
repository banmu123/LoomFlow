import type {
  SearchProvider,
  SearchProviderDefinition,
} from './capabilities';

// ===== SearchProviderRegistry =====
// 镜像 ModelRegistry：负责 provider 类型注册 / 配置查询 / 实例创建。
// - 类型工厂注册：内置类型（tavily/exa/google）在 providers/index 中注册；
//   第三方 provider 可调用 registerType 扩展（与 NodeRegistry 一致的可扩展性）。
// - 配置查询：定义来自数据库（db-providers 加载），可注册到 registry 或直接按 id 查询。

export type SearchProviderFactory = (def: SearchProviderDefinition) => SearchProvider;

export class SearchProviderRegistry {
  /** provider 类型 → 实例工厂 */
  private factories = new Map<string, SearchProviderFactory>();
  /** 配置 ID → 定义（运行时注册；DB 定义由 db-providers 加载后也可注册） */
  private definitions = new Map<string, SearchProviderDefinition>();

  /** 注册 provider 类型工厂（如 'tavily' → TavilyProvider） */
  registerType(type: string, factory: SearchProviderFactory): void {
    this.factories.set(type, factory);
  }

  unregisterType(type: string): void {
    this.factories.delete(type);
  }

  hasType(type: string): boolean {
    return this.factories.has(type);
  }

  listTypes(): string[] {
    return [...this.factories.keys()];
  }

  /** 注册配置定义 */
  register(def: SearchProviderDefinition): void {
    this.definitions.set(def.id, def);
  }

  unregister(id: string): void {
    this.definitions.delete(id);
  }

  get(id: string): SearchProviderDefinition | undefined {
    return this.definitions.get(id);
  }

  list(): SearchProviderDefinition[] {
    return [...this.definitions.values()];
  }

  /** 仅启用中的配置 */
  listEnabled(): SearchProviderDefinition[] {
    return this.list().filter((d) => d.enabled);
  }

  /** 按配置创建 provider 实例（工厂分发，节点/执行器不关心具体类型） */
  create(def: SearchProviderDefinition): SearchProvider {
    const factory = this.factories.get(def.provider);
    if (!factory) {
      throw new Error(`未知搜索 provider 类型: ${def.provider}`);
    }
    return factory(def);
  }

  /** 按 id 查询并创建实例（便捷入口） */
  createById(id: string): SearchProvider | null {
    const def = this.get(id);
    if (!def) return null;
    return this.create(def);
  }
}

// 全局单例（内置 provider 类型在 providers/index 中注册）
export const searchProviderRegistry = new SearchProviderRegistry();
