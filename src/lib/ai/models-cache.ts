// 模型列表客户端缓存（/api/ai/models 消费方众多：聊天面板/欢迎页/画布助手/画布包装器/
// 模板规范化/节点定义——此前每次挂载都各自请求一遍）
// - TTL 60s + 并发去重（同一时刻多次调用只发一次请求）
// - 模型配置页（admin/models）管理 CRUD，需要强一致，不接此缓存
// 注意：不加 'use client'——本模块被服务端模块（workflow-templates/nodes/builtin）导入，
// 保持框架无关；函数仅应在前端调用（fetch 依赖浏览器 cookie）

export interface ModelOption {
  value: string;
  label: string;
}

export const MODELS_CACHE_TTL_MS = 60_000;

let cache: ModelOption[] | null = null;
let cacheTime = 0;
let inflight: Promise<ModelOption[]> | null = null;

export function invalidateModelOptionsCache(): void {
  cache = null;
  cacheTime = 0;
}

export async function fetchModelOptions(force = false): Promise<ModelOption[]> {
  if (!force && cache && Date.now() - cacheTime < MODELS_CACHE_TTL_MS) return cache;
  if (!force && inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch('/api/ai/models');
      const data = await res.json();
      if (Array.isArray(data)) {
        cache = data.map((m: { id: string; label: string | null }) => ({
          value: m.id,
          label: m.label || m.id,
        }));
        cacheTime = Date.now();
      }
    } catch {
      // 拉取失败：保留旧缓存（若有），否则返回空列表
    } finally {
      inflight = null;
    }
    return cache ?? [];
  })();
  return inflight;
}
