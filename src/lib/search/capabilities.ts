// ===== Search Provider Capability 定义 =====
// 镜像 Model Registry 的 ModelCapability 设计

export type SearchCapability = 'web' | 'news' | 'image' | 'video';

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export interface SearchOptions {
  /** 返回结果条数上限（默认 5） */
  maxResults?: number;
  /** provider 专属扩展参数（透传给具体实现） */
  extra?: Record<string, unknown>;
}

/** 统一搜索输出 */
export interface SearchResponse {
  results: SearchResult[];
}

/** 连接测试结果（后台「测试连接」按钮用） */
export interface ConnectionTestResult {
  ok: boolean;
  message?: string;
}

/** 统一的 Search Provider 接口——节点不直接调用具体服务 */
export interface SearchProvider {
  readonly type: string;
  search(query: string, options?: SearchOptions): Promise<SearchResponse>;
  testConnection?(): Promise<ConnectionTestResult>;
}

/** 搜索服务配置（对应 DB search_providers 表一行） */
export interface SearchProviderDefinition {
  /** 配置 ID（用户可读，TEXT PK） */
  id: string;
  /** Provider 类型（tavily / exa / google / ...） */
  provider: string;
  label?: string;
  apiKey: string;
  /** 自定义端点（留空用默认） */
  baseURL?: string;
  /** provider 专属配置（如 google 的 cx） */
  config?: Record<string, unknown>;
  enabled: boolean;
  capabilities: SearchCapability[];
}

/** 判断搜索服务是否具备某能力 */
export function hasCapability(
  def: SearchProviderDefinition,
  cap: SearchCapability,
): boolean {
  return def.capabilities.includes(cap);
}
