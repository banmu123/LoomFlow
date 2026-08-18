import type { SearchCapability, SearchProviderDefinition } from './capabilities';
import { supabase } from '@/lib/supabase/server';
import { decryptSecret } from '@/lib/secrets';

// ===== 数据库搜索服务加载（镜像 ai/db-models.ts）=====

interface DbSearchProviderRow {
  id: string;
  provider: string;
  label: string | null;
  api_key: string | null;
  base_url: string | null;
  config: Record<string, unknown> | null;
  capabilities: string[];
  enabled: boolean;
}

let cache: SearchProviderDefinition[] | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 30_000;

export function invalidateSearchProvidersCache(): void {
  cache = null;
}

// 从数据库加载用户配置的搜索服务（缓存 30s；失败时回退空列表）
async function loadFromDb(): Promise<SearchProviderDefinition[]> {
  const { data, error } = await supabase
    .from('search_providers')
    .select('id, provider, label, api_key, base_url, config, capabilities, enabled')
    .order('id');

  if (error || !data) return [];

  return (data as DbSearchProviderRow[]).map((row) => ({
    id: row.id,
    provider: row.provider,
    label: row.label || undefined,
    // 解密存储的 apiKey（旧明文数据透明兼容）
    apiKey: row.api_key ? decryptSecret(row.api_key) : '',
    baseURL: row.base_url || undefined,
    config: row.config ?? {},
    capabilities: (Array.isArray(row.capabilities) ? row.capabilities : ['web']) as SearchCapability[],
    enabled: row.enabled !== false,
  }));
}

// 获取全部搜索服务（含 apiKey——仅服务端使用，禁止在 API 返回中暴露）
export async function getAllSearchProviders(): Promise<SearchProviderDefinition[]> {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL_MS) {
    return cache;
  }

  const dbProviders = await loadFromDb();
  cache = dbProviders;
  cacheTime = now;
  return cache;
}

// 仅启用中的搜索服务（画布 provider 下拉 / 节点默认选择用）
export async function getEnabledSearchProviders(): Promise<SearchProviderDefinition[]> {
  const all = await getAllSearchProviders();
  return all.filter((d) => d.enabled);
}

/** 按 id 查询（执行器用） */
export async function getSearchProviderById(
  id: string,
): Promise<SearchProviderDefinition | undefined> {
  const all = await getAllSearchProviders();
  return all.find((d) => d.id === id);
}
