import { describe, it, expect } from 'vitest';
import { CircuitBreaker } from '../circuit-breaker';

describe('Circuit Breaker', () => {
  it('连续失败达到阈值后打开', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    const key = 'deepseek:model-a';

    breaker.recordFailure(key, 0);
    breaker.recordFailure(key, 10);
    expect(breaker.state(key, 20)).toBe('closed');

    breaker.recordFailure(key, 30);
    expect(breaker.state(key, 40)).toBe('open');
    expect(breaker.canAttempt(key, 40)).toBe(false);
  });

  it('冷却后进入 half-open，只放一个探测请求', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000 });
    const key = 'p:m';
    breaker.recordFailure(key, 0);

    expect(breaker.state(key, 500)).toBe('open');
    expect(breaker.state(key, 1500)).toBe('half_open');
    expect(breaker.canAttempt(key, 1500)).toBe(true);
    expect(breaker.canAttempt(key, 1500)).toBe(false);
  });

  it('探测成功恢复 closed', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000 });
    const key = 'p:m';
    breaker.recordFailure(key, 0);
    expect(breaker.canAttempt(key, 2000)).toBe(true);

    breaker.recordSuccess(key);
    expect(breaker.state(key, 2000)).toBe('closed');
    expect(breaker.canAttempt(key, 2000)).toBe(true);
  });

  it('half-open 探测失败立即重新打开', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000 });
    const key = 'p:m';
    breaker.recordFailure(key, 0);
    breaker.canAttempt(key, 2000);
    breaker.recordFailure(key, 2000);

    expect(breaker.state(key, 2500)).toBe('open');
  });

  it('快照暴露每个 key 的状态', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1 });
    breaker.recordFailure('a:b', 0);
    expect(breaker.snapshot(0)).toEqual({ 'a:b': 'open' });
  });
});
