'use client';

// 对话历史内存缓存（跨路由切换复用，模块级单例）
// 目的：侧边栏切换对话时消除"双请求瀑布"（/api/conversations + /messages），
// 悬停即预取，点击时缓存命中则零请求即时渲染。
// 一致性约定：
// - 任何发送/删除都会触发 conversations-updated → SidebarNav 重拉列表时整体清空缓存
// - 末条为 user-done 的对话可能是"别处生成中"，消费方（ChatPanel）须跳过缓存走全新拉取
// - 缓存带 TTL，过期后回退原有拉取路径

export interface CachedMessageRow {
  id: string;
  role: string;
  content: string;
  reasoning?: string | null;
  status?: string | null;
  error?: string | null;
  images?: string[] | null;
  created_at?: string;
}

export interface CachedConversationHistory {
  title: string;
  model: string | null;
  messages: CachedMessageRow[];
  fetchedAt: number;
}

export const HISTORY_CACHE_TTL_MS = 60_000;

const cache = new Map<string, CachedConversationHistory>();

export function getCachedConversationHistory(id: string): CachedConversationHistory | undefined {
  return cache.get(id);
}

export function setCachedConversationHistory(
  id: string,
  entry: Omit<CachedConversationHistory, 'fetchedAt'>,
): void {
  cache.set(id, { ...entry, fetchedAt: Date.now() });
}

export function deleteCachedConversationHistory(id: string): void {
  cache.delete(id);
}

export function clearAllConversationHistoryCache(): void {
  cache.clear();
}

/**
 * 悬停预取：拉取对话历史写入缓存（fire-and-forget，失败静默）。
 * meta 可选传入（侧边栏已有 title/model），避免为 meta 单独请求。
 */
export async function prefetchConversationHistory(
  id: string,
  meta?: { title?: string; model?: string | null },
): Promise<void> {
  const prev = cache.get(id);
  if (prev && Date.now() - prev.fetchedAt < HISTORY_CACHE_TTL_MS) return;
  try {
    const res = await fetch(`/api/conversations/${id}/messages`);
    if (!res.ok) return;
    const msgs = (await res.json()) as CachedMessageRow[];
    if (!Array.isArray(msgs)) return;
    cache.set(id, {
      title: meta?.title ?? prev?.title ?? '',
      model: meta?.model ?? prev?.model ?? null,
      messages: msgs,
      fetchedAt: Date.now(),
    });
  } catch {
    // 预取失败静默：点击时回退原有拉取路径
  }
}
