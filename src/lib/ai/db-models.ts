import type { ModelCapability, ModelDefinition } from './capabilities';
import { supabase } from '@/lib/supabase/server';

// ===== 数据库模型加载（内置模型 + 用户配置合并）=====

interface DbModelRow {
  id: string;
  provider: string;
  capabilities: string[];
  label: string | null;
  base_url: string | null;
  api_key: string | null;
}

let cache: ModelDefinition[] | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 30_000;

export function invalidateModelsCache(): void {
  cache = null;
}

// 从数据库加载用户配置的模型（缓存 30s；失败时回退空列表）
async function loadFromDb(): Promise<ModelDefinition[]> {
  const { data, error } = await supabase
    .from('ai_models')
    .select('id, provider, capabilities, label, base_url, api_key');

  if (error || !data) return [];

  return (data as DbModelRow[]).map((row) => ({
    id: row.id,
    provider: row.provider,
    capabilities: (Array.isArray(row.capabilities) ? row.capabilities : ['text']) as ModelCapability[],
    label: row.label || undefined,
    baseURL: row.base_url || undefined,
    apiKey: row.api_key || undefined,
  }));
}

// 获取全部可用模型（仅来自数据库——用户必须在「模型配置」中添加）
// 初始为空时，对话/LLM 节点会提示先配置模型（引导式体验）
export async function getAllModels(): Promise<ModelDefinition[]> {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL_MS) {
    return cache;
  }

  const dbModels = await loadFromDb();
  cache = dbModels;
  cacheTime = now;
  return cache;
}
