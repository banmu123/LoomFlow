/**
 * 重试退避：指数增长 + 上限 + 可选抖动。
 * 与 SQL 侧 loomflow_reap_expired_flow_jobs 的公式保持同量级（5s 起，300s 封顶）。
 */

export const DEFAULT_BACKOFF_BASE_MS = 5_000;
export const DEFAULT_BACKOFF_MAX_MS = 300_000;

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  /** 注入随机源便于测试；默认 Math.random */
  random?: () => number;
}

/**
 * attempts 为已经发生的尝试次数（1 = 第一次失败后）。
 * 返回值用于计算下一次 available_at。
 */
export function computeBackoffMs(attempts: number, options: BackoffOptions = {}): number {
  const base = options.baseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const max = options.maxMs ?? DEFAULT_BACKOFF_MAX_MS;
  const safeAttempts = Math.max(1, Math.floor(attempts));
  const exponential = base * Math.pow(2, safeAttempts - 1);
  const capped = Math.min(exponential, max);
  const random = options.random ?? Math.random;
  // 20% 抖动，避免多个任务同一时刻集中重试
  const jitter = capped * 0.2 * random();
  return Math.round(Math.min(capped + jitter, max));
}

/** 是否还剩重试机会（attempts 为已消耗次数） */
export function hasAttemptsLeft(attempts: number, maxAttempts: number): boolean {
  return attempts < maxAttempts;
}
