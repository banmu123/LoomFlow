import type { ModelCapability, ModelDefinition } from './capabilities';
import { supabase } from '@/lib/supabase/server';

// ===== 数据库模型加载（内置模型 + 用户配置合并）=====

interface DbModelRow {
  id: string;
  provider: string;
  capabilities: string[];
  label: string | null;
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
    .select('id, provider, capabilities, label');

  if (error || !data) return [];

  return (data as DbModelRow[]).map((row) => ({
    id: row.id,
    provider: row.provider,
    capabilities: (Array.isArray(row.capabilities) ? row.capabilities : ['text']) as ModelCapability[],
    label: row.label || undefined,
  }));
}

// 获取全部可用模型（DB 配置优先，覆盖内置同名模型）
export async function getAllModels(): Promise<ModelDefinition[]> {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL_MS) {
    return cache;
  }

  const [dbModels, builtin] = await Promise.all([
    loadFromDb(),
    import('./models').then((m) => m.BUILTIN_MODELS),
  ]);

  // 合并：DB 优先（同名覆盖内置）
  const merged = new Map<string, ModelDefinition>();
  for (const m of builtin) merged.set(m.id, m);
  for (const m of dbModels) merged.set(m.id, m);

  cache = [...merged.values()];
  cacheTime = now;
  return cache;
}
