'use client';

// 对话列表客户端缓存（/api/conversations）
// 消费方：侧边栏（强一致源：事件触发时 force 重拉并回写缓存）、
// ChatPanel 冷路径（只为取 meta，TTL 内直接复用，省一次全列表请求）

export interface ConversationMeta {
  id: string;
  title: string;
  model?: string | null;
}

export const CONVERSATIONS_CACHE_TTL_MS = 15_000;

let cache: ConversationMeta[] | null = null;
let cacheTime = 0;
let inflight: Promise<ConversationMeta[]> | null = null;

export function invalidateConversationsCache(): void {
  cache = null;
  cacheTime = 0;
}

export async function fetchConversationsList(force = false): Promise<ConversationMeta[]> {
  if (!force && cache && Date.now() - cacheTime < CONVERSATIONS_CACHE_TTL_MS) return cache;
  if (!force && inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch('/api/conversations');
      const data = await res.json();
      if (Array.isArray(data)) {
        cache = data.map(
          (c: { id: string; title: string; model?: string | null }) => ({
            id: c.id,
            title: c.title || '',
            model: c.model ?? null,
          }),
        );
        cacheTime = Date.now();
      }
    } catch {
      // 拉取失败：保留旧缓存（若有）
    } finally {
      inflight = null;
    }
    return cache ?? [];
  })();
  return inflight;
}
