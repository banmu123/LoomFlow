import { isCancelledError, isConfirmError } from './errors';
import { sleep } from './timeout';

export interface RetryPolicy {
  /** 最大重试次数（0 = 不重试） */
  maxRetries: number;
  /** 初始退避间隔（ms） */
  retryDelayMs: number;
  /** 是否指数退避 */
  exponentialBackoff: boolean;
  /** 不可重试的错误码（如 confirm_required / 配置错误） */
  nonRetryableCodes?: string[];
}

export interface RetryAttemptInfo {
  attempt: number;
  maxRetries: number;
  error: unknown;
  nextDelayMs: number;
}

/** 判断错误是否可重试 */
export function isRetryableError(err: unknown, policy: RetryPolicy): boolean {
  if (policy.maxRetries <= 0) return false;
  if (isCancelledError(err)) return false;
  if (isConfirmError(err)) return false;

  const code = (err as { code?: string } | undefined)?.code;
  if (code && policy.nonRetryableCodes?.includes(code)) return false;
  return true;
}

export interface RetryOptions {
  /** 每次尝试后回调（用于写 trace / 记录 attempt） */
  onAttempt?: (info: RetryAttemptInfo) => void;
  signal?: AbortSignal;
}

/**
 * 带策略的重试执行：
 *   attempt 1 → failed → wait → attempt 2 → ... → 最终失败时抛出最后一次错误。
 * 错误分类：取消/确认/配置类错误不可重试，立即抛出。
 */
export async function retryWithPolicy<T>(
  fn: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  options: RetryOptions = {},
): Promise<T> {
  let attempt = 1;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (!isRetryableError(err, policy)) throw err;
      if (attempt >= policy.maxRetries + 1) throw err;

      const exponent = attempt - 1;
      const delay = policy.exponentialBackoff
        ? policy.retryDelayMs * 2 ** exponent
        : policy.retryDelayMs;
      options.onAttempt?.({ attempt, maxRetries: policy.maxRetries, error: err, nextDelayMs: delay });
      await sleep(delay, options.signal);
      attempt += 1;
    }
  }
}
