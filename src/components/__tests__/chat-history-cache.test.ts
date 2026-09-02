import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getCachedConversationHistory,
  setCachedConversationHistory,
  deleteCachedConversationHistory,
  clearAllConversationHistoryCache,
  prefetchConversationHistory,
  HISTORY_CACHE_TTL_MS,
} from '../chat-history-cache';

const ROWS = [
  { id: 'm1', role: 'user', content: '你好', status: 'done', created_at: '2026-09-02T00:00:00Z' },
  { id: 'm2', role: 'assistant', content: '回复', status: 'done', created_at: '2026-09-02T00:00:01Z' },
];

describe('chat-history-cache', () => {
  beforeEach(() => {
    clearAllConversationHistoryCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('set/get/delete 基本语义', () => {
    setCachedConversationHistory('c1', { title: 'T', model: null, messages: ROWS });
    expect(getCachedConversationHistory('c1')?.title).toBe('T');
    expect(getCachedConversationHistory('c1')?.messages).toHaveLength(2);
    deleteCachedConversationHistory('c1');
    expect(getCachedConversationHistory('c1')).toBeUndefined();
  });

  it('prefetch 拉取接口并写入缓存', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(ROWS) }),
    );
    await prefetchConversationHistory('c2', { title: '标题', model: 'mimo-v2.5-pro' });
    const cached = getCachedConversationHistory('c2');
    expect(cached?.title).toBe('标题');
    expect(cached?.model).toBe('mimo-v2.5-pro');
    expect(cached?.fetchedAt).toBeGreaterThan(0);
  });

  it('prefetch TTL 内去重（不重复请求）', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(ROWS) });
    vi.stubGlobal('fetch', fetchMock);
    await prefetchConversationHistory('c3');
    await prefetchConversationHistory('c3');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // TTL 过期后重新拉取
    vi.advanceTimersByTime(HISTORY_CACHE_TTL_MS + 1);
    await prefetchConversationHistory('c3');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('prefetch 失败静默（不写缓存、不抛错）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await expect(prefetchConversationHistory('c4')).resolves.toBeUndefined();
    expect(getCachedConversationHistory('c4')).toBeUndefined();
  });

  it('prefetch 接口报错（ok=false）不写缓存', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    await prefetchConversationHistory('c5');
    expect(getCachedConversationHistory('c5')).toBeUndefined();
  });

  it('clearAll 清空全部', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(ROWS) }),
    );
    await prefetchConversationHistory('c6');
    await prefetchConversationHistory('c7');
    clearAllConversationHistoryCache();
    expect(getCachedConversationHistory('c6')).toBeUndefined();
    expect(getCachedConversationHistory('c7')).toBeUndefined();
  });
});
