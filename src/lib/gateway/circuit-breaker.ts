/**
 * Circuit Breaker（进程内）。
 *
 * 目的：Provider 持续 429/5xx 时，短时间内不再打它，避免请求放大。
 * 语义：连续失败 N 次 → open；冷却后进入 half-open，只放一个探测请求；
 *       探测成功 → closed，失败 → 重新 open。
 *
 * 说明：状态是进程内内存，多副本各自独立；不宣称全局精确熔断。
 */

export type BreakerState = 'closed' | 'open' | 'half_open';

interface Entry {
  failures: number;
  openedAt: number | null;
  halfOpenInFlight: boolean;
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
}

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly entries = new Map<string, Entry>();

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = Math.max(1, options.failureThreshold ?? 3);
    this.cooldownMs = Math.max(1_000, options.cooldownMs ?? 30_000);
  }

  private entry(key: string): Entry {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { failures: 0, openedAt: null, halfOpenInFlight: false };
      this.entries.set(key, entry);
    }
    return entry;
  }

  state(key: string, now: number = Date.now()): BreakerState {
    const entry = this.entries.get(key);
    if (!entry || entry.openedAt === null) return 'closed';
    return now - entry.openedAt >= this.cooldownMs ? 'half_open' : 'open';
  }

  canAttempt(key: string, now: number = Date.now()): boolean {
    const state = this.state(key, now);
    if (state === 'closed') return true;
    if (state === 'open') return false;

    // half-open：只放一个探测请求
    const entry = this.entry(key);
    if (entry.halfOpenInFlight) return false;
    entry.halfOpenInFlight = true;
    return true;
  }

  recordSuccess(key: string): void {
    this.entries.set(key, { failures: 0, openedAt: null, halfOpenInFlight: false });
  }

  recordFailure(key: string, now: number = Date.now()): void {
    const entry = this.entry(key);
    entry.halfOpenInFlight = false;
    entry.failures += 1;

    // half-open 下失败立即重新打开
    if (entry.openedAt !== null) {
      entry.openedAt = now;
      return;
    }
    if (entry.failures >= this.failureThreshold) {
      entry.openedAt = now;
    }
  }

  snapshot(now: number = Date.now()): Record<string, BreakerState> {
    const result: Record<string, BreakerState> = {};
    for (const key of this.entries.keys()) {
      result[key] = this.state(key, now);
    }
    return result;
  }

  reset(): void {
    this.entries.clear();
  }
}
