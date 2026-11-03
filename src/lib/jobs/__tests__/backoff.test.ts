import { describe, it, expect } from 'vitest';
import { computeBackoffMs, hasAttemptsLeft } from '../backoff';

describe('任务重试退避', () => {
  it('按 5s 起步指数增长', () => {
    expect(computeBackoffMs(1, { random: () => 0 })).toBe(5_000);
    expect(computeBackoffMs(2, { random: () => 0 })).toBe(10_000);
    expect(computeBackoffMs(3, { random: () => 0 })).toBe(20_000);
  });

  it('不超过上限', () => {
    expect(computeBackoffMs(20, { random: () => 1 })).toBe(300_000);
  });

  it('抖动不超过 20% 且不超过上限', () => {
    const capped = computeBackoffMs(4, { random: () => 1 });
    expect(capped).toBeLessThanOrEqual(300_000);
    expect(capped).toBeGreaterThanOrEqual(40_000);
  });

  it('attempts 非法值按 1 处理', () => {
    expect(computeBackoffMs(0, { random: () => 0 })).toBe(5_000);
    expect(computeBackoffMs(-3, { random: () => 0 })).toBe(5_000);
  });

  it('剩余次数判断', () => {
    expect(hasAttemptsLeft(1, 3)).toBe(true);
    expect(hasAttemptsLeft(2, 3)).toBe(true);
    expect(hasAttemptsLeft(3, 3)).toBe(false);
  });
});
