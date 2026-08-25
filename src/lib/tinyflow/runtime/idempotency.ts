export interface IdempotentResult {
  flowId: string;
  status: string;
  outputs?: Record<string, unknown>;
  error?: string;
  /** 标记为重复请求（未重复执行） */
  duplicate: boolean;
}

/**
 * 内存幂等存储：同一 idempotencyKey 在 TTL 内返回首次执行结果，
 * 防止「同一 request 重复执行、重复写入副作用」。
 * 进程外兜底：flow_runs.idempotency_key 唯一索引。
 */
export class IdempotencyStore {
  private store = new Map<string, { result: IdempotentResult; expiresAt: number }>();
  private readonly ttlMs: number;

  constructor(ttlMs = 60 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  /** 尝试认领 key；已存在且在有效期内返回历史结果 */
  claim(
    key: string,
    makeResult: () => IdempotentResult,
  ): { created: boolean; result: IdempotentResult } {
    const now = Date.now();
    const existing = this.store.get(key);
    if (existing && existing.expiresAt > now) {
      return { created: false, result: { ...existing.result, duplicate: true } };
    }
    const result = makeResult();
    this.store.set(key, { result, expiresAt: now + this.ttlMs });
    return { created: true, result };
  }

  /** 覆盖已认领 key 的最终结果（首次执行完成后写回，避免并发窗口读到 running） */
  settle(key: string, result: IdempotentResult): void {
    const existing = this.store.get(key);
    if (existing) {
      this.store.set(key, { result: { ...result, duplicate: false }, expiresAt: existing.expiresAt });
    }
  }

  get(key: string): IdempotentResult | undefined {
    const existing = this.store.get(key);
    if (!existing) return undefined;
    if (existing.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return existing.result;
  }

  clear(): void {
    this.store.clear();
  }
}

export const idempotencyStore = new IdempotencyStore();
