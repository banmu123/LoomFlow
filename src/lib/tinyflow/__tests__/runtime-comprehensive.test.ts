import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isTerminalState,
  isActiveState,
  canTransition,
  runStateToPersistedStatus,
} from '../runtime/state';
import {
  RunTimeoutError,
  RunCancelledError,
  isConfirmError,
  isCancelledError,
  isTimeoutError,
  toErrorMessage,
} from '../runtime/errors';
import { isRetryableError, retryWithPolicy } from '../runtime/retry';
import { IdempotencyStore } from '../runtime/idempotency';
import type { RetryPolicy } from '../runtime/retry';
import type { RunState } from '../runtime/state';

// ===== State Machine Tests =====

describe('RunState State Machine', () => {
  describe('isTerminalState', () => {
    it('should return true for terminal states', () => {
      expect(isTerminalState('completed')).toBe(true);
      expect(isTerminalState('failed')).toBe(true);
      expect(isTerminalState('cancelled')).toBe(true);
      expect(isTerminalState('timeout')).toBe(true);
    });

    it('should return false for non-terminal states', () => {
      expect(isTerminalState('created')).toBe(false);
      expect(isTerminalState('running')).toBe(false);
      expect(isTerminalState('waiting')).toBe(false);
      expect(isTerminalState('paused')).toBe(false);
    });
  });

  describe('isActiveState', () => {
    it('should return true only for running state', () => {
      expect(isActiveState('running')).toBe(true);
    });

    it('should return false for all other states', () => {
      expect(isActiveState('created')).toBe(false);
      expect(isActiveState('completed')).toBe(false);
      expect(isActiveState('failed')).toBe(false);
      expect(isActiveState('waiting')).toBe(false);
      expect(isActiveState('paused')).toBe(false);
      expect(isActiveState('cancelled')).toBe(false);
      expect(isActiveState('timeout')).toBe(false);
    });
  });

  describe('canTransition', () => {
    it('should allow valid transitions from created', () => {
      expect(canTransition('created', 'running')).toBe(true);
      expect(canTransition('created', 'cancelled')).toBe(true);
      expect(canTransition('created', 'failed')).toBe(true);
    });

    it('should not allow invalid transitions from created', () => {
      expect(canTransition('created', 'completed')).toBe(false);
      expect(canTransition('created', 'waiting')).toBe(false);
      expect(canTransition('created', 'paused')).toBe(false);
      expect(canTransition('created', 'timeout')).toBe(false);
    });

    it('should allow valid transitions from running', () => {
      expect(canTransition('running', 'completed')).toBe(true);
      expect(canTransition('running', 'failed')).toBe(true);
      expect(canTransition('running', 'cancelled')).toBe(true);
      expect(canTransition('running', 'timeout')).toBe(true);
      expect(canTransition('running', 'waiting')).toBe(true);
    });

    it('should not allow transitions from terminal states', () => {
      expect(canTransition('completed', 'running')).toBe(false);
      expect(canTransition('failed', 'running')).toBe(false);
      expect(canTransition('cancelled', 'running')).toBe(false);
      expect(canTransition('timeout', 'running')).toBe(false);
    });

    it('should allow resume from waiting and paused', () => {
      expect(canTransition('waiting', 'running')).toBe(true);
      expect(canTransition('paused', 'running')).toBe(true);
    });
  });

  describe('runStateToPersistedStatus', () => {
    it('should map waiting and paused to paused', () => {
      expect(runStateToPersistedStatus('waiting')).toBe('paused');
      expect(runStateToPersistedStatus('paused')).toBe('paused');
    });

    it('should map created and running to running', () => {
      expect(runStateToPersistedStatus('created')).toBe('running');
      expect(runStateToPersistedStatus('running')).toBe('running');
    });

    it('should pass through terminal states', () => {
      expect(runStateToPersistedStatus('completed')).toBe('completed');
      expect(runStateToPersistedStatus('failed')).toBe('failed');
      expect(runStateToPersistedStatus('cancelled')).toBe('cancelled');
      expect(runStateToPersistedStatus('timeout')).toBe('timeout');
    });
  });
});

// ===== Error Types Tests =====

describe('Runtime Error Types', () => {
  describe('RunTimeoutError', () => {
    it('should create timeout error with correct properties', () => {
      const err = new RunTimeoutError('Timeout', 5000, 'node-1');
      expect(err.name).toBe('RunTimeoutError');
      expect(err.code).toBe('timeout');
      expect(err.timeoutMs).toBe(5000);
      expect(err.nodeId).toBe('node-1');
      expect(err.message).toBe('Timeout');
    });

    it('should create timeout error without nodeId', () => {
      const err = new RunTimeoutError('Flow timeout', 10000);
      expect(err.nodeId).toBeUndefined();
      expect(err.timeoutMs).toBe(10000);
    });
  });

  describe('RunCancelledError', () => {
    it('should create cancelled error with default message', () => {
      const err = new RunCancelledError();
      expect(err.name).toBe('RunCancelledError');
      expect(err.code).toBe('cancelled');
      expect(err.message).toBe('执行已取消');
    });

    it('should create cancelled error with custom message', () => {
      const err = new RunCancelledError('Custom cancel');
      expect(err.message).toBe('Custom cancel');
    });
  });

  describe('Error type guards', () => {
    it('isConfirmError should identify confirm errors', () => {
      const confirmErr = { code: 'confirm_required', message: 'Need confirm' };
      expect(isConfirmError(confirmErr)).toBe(true);
      expect(isConfirmError(new Error('normal'))).toBe(false);
      expect(isConfirmError(null)).toBe(false);
      expect(isConfirmError(undefined)).toBe(false);
    });

    it('isCancelledError should identify cancelled errors', () => {
      const cancelErr = new RunCancelledError();
      expect(isCancelledError(cancelErr)).toBe(true);
      expect(isCancelledError({ code: 'cancelled' })).toBe(true);
      expect(isCancelledError({ name: 'AbortError' } as Error)).toBe(true);
      expect(isCancelledError(new Error('normal'))).toBe(false);
    });

    it('isTimeoutError should identify timeout errors', () => {
      const timeoutErr = new RunTimeoutError('Timeout', 1000);
      expect(isTimeoutError(timeoutErr)).toBe(true);
      expect(isTimeoutError({ code: 'timeout' })).toBe(true);
      expect(isTimeoutError({ name: 'TimeoutError' } as Error)).toBe(true);
      expect(isTimeoutError(new Error('normal'))).toBe(false);
    });

    it('toErrorMessage should extract readable messages', () => {
      expect(toErrorMessage(new Error('test error'))).toBe('test error');
      expect(toErrorMessage('string error')).toBe('string error');
      expect(toErrorMessage(123)).toBe('123');
      expect(toErrorMessage(null)).toBe('未知错误');
      expect(toErrorMessage(undefined)).toBe('未知错误');
    });
  });
});

// ===== Retry Policy Tests =====

describe('Retry Policy', () => {
  describe('isRetryableError', () => {
    const policy: RetryPolicy = {
      maxRetries: 3,
      retryDelayMs: 100,
      exponentialBackoff: true,
    };

    it('should not retry when maxRetries is 0', () => {
      const zeroPolicy = { ...policy, maxRetries: 0 };
      expect(isRetryableError(new Error('test'), zeroPolicy)).toBe(false);
    });

    it('should not retry cancelled errors', () => {
      expect(isRetryableError(new RunCancelledError(), policy)).toBe(false);
    });

    it('should not retry confirm errors', () => {
      expect(isRetryableError({ code: 'confirm_required' }, policy)).toBe(false);
    });

    it('should not retry non-retryable error codes', () => {
      const policyWithCodes = { ...policy, nonRetryableCodes: ['config_error'] };
      expect(isRetryableError({ code: 'config_error' }, policyWithCodes)).toBe(false);
    });

    it('should retry regular errors', () => {
      expect(isRetryableError(new Error('network error'), policy)).toBe(true);
      expect(isRetryableError({ code: 'timeout' }, policy)).toBe(true);
    });
  });

  describe('retryWithPolicy', () => {
    it('should succeed on first attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const policy: RetryPolicy = {
        maxRetries: 3,
        retryDelayMs: 10,
        exponentialBackoff: false,
      };

      const result = await retryWithPolicy(fn, policy);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success');

      const policy: RetryPolicy = {
        maxRetries: 3,
        retryDelayMs: 10,
        exponentialBackoff: false,
      };

      const result = await retryWithPolicy(fn, policy);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw after max retries exceeded', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('persistent failure'));
      const policy: RetryPolicy = {
        maxRetries: 2,
        retryDelayMs: 10,
        exponentialBackoff: false,
      };

      await expect(retryWithPolicy(fn, policy)).rejects.toThrow('persistent failure');
      expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    it('should not retry non-retryable errors', async () => {
      const fn = vi.fn().mockRejectedValue(new RunCancelledError());
      const policy: RetryPolicy = {
        maxRetries: 3,
        retryDelayMs: 10,
        exponentialBackoff: false,
      };

      await expect(retryWithPolicy(fn, policy)).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should call onAttempt callback', async () => {
      const onAttempt = vi.fn();
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const policy: RetryPolicy = {
        maxRetries: 3,
        retryDelayMs: 10,
        exponentialBackoff: false,
      };

      await retryWithPolicy(fn, policy, { onAttempt });
      expect(onAttempt).toHaveBeenCalledWith({
        attempt: 1,
        maxRetries: 3,
        error: expect.any(Error),
        nextDelayMs: 10,
      });
    });

    it('should use exponential backoff when configured', async () => {
      const onAttempt = vi.fn();
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success');

      const policy: RetryPolicy = {
        maxRetries: 3,
        retryDelayMs: 100,
        exponentialBackoff: true,
      };

      await retryWithPolicy(fn, policy, { onAttempt });
      expect(onAttempt).toHaveBeenNthCalledWith(1, expect.objectContaining({ nextDelayMs: 100 }));
      expect(onAttempt).toHaveBeenNthCalledWith(2, expect.objectContaining({ nextDelayMs: 200 }));
    });
  });
});

// ===== Idempotency Store Tests =====

describe('IdempotencyStore', () => {
  let store: IdempotencyStore;

  beforeEach(() => {
    store = new IdempotencyStore(60000); // 1 minute TTL
  });

  it('should claim new key successfully', () => {
    const result = store.claim('key-1', () => ({
      flowId: 'flow-1',
      status: 'running',
      duplicate: false,
    }));

    expect(result.created).toBe(true);
    expect(result.result.flowId).toBe('flow-1');
    expect(result.result.duplicate).toBe(false);
  });

  it('should return duplicate for existing key', () => {
    store.claim('key-1', () => ({
      flowId: 'flow-1',
      status: 'running',
      duplicate: false,
    }));

    const result = store.claim('key-1', () => ({
      flowId: 'flow-2',
      status: 'running',
      duplicate: false,
    }));

    expect(result.created).toBe(false);
    expect(result.result.duplicate).toBe(true);
  });

  it('should settle and update result', () => {
    store.claim('key-1', () => ({
      flowId: 'flow-1',
      status: 'running',
      duplicate: false,
    }));

    store.settle('key-1', {
      flowId: 'flow-1',
      status: 'completed',
      outputs: { result: 'done' },
      duplicate: false,
    });

    const result = store.get('key-1');
    expect(result?.status).toBe('completed');
    expect(result?.outputs).toEqual({ result: 'done' });
  });

  it('should return undefined for non-existent key', () => {
    expect(store.get('non-existent')).toBeUndefined();
  });

  it('should handle expired keys', () => {
    const shortTtlStore = new IdempotencyStore(1); // 1ms TTL
    
    shortTtlStore.claim('key-1', () => ({
      flowId: 'flow-1',
      status: 'running',
      duplicate: false,
    }));

    // Wait for expiration
    vi.useFakeTimers();
    vi.advanceTimersByTime(10);

    expect(shortTtlStore.get('key-1')).toBeUndefined();
    vi.useRealTimers();
  });

  it('should clear all entries', () => {
    store.claim('key-1', () => ({ flowId: 'flow-1', status: 'running', duplicate: false }));
    store.claim('key-2', () => ({ flowId: 'flow-2', status: 'running', duplicate: false }));

    store.clear();

    expect(store.get('key-1')).toBeUndefined();
    expect(store.get('key-2')).toBeUndefined();
  });

  it('should not create duplicate on claim after settle', () => {
    store.claim('key-1', () => ({ flowId: 'flow-1', status: 'running', duplicate: false }));
    store.settle('key-1', { flowId: 'flow-1', status: 'completed', duplicate: false });

    const result = store.claim('key-1', () => ({ flowId: 'flow-2', status: 'running', duplicate: false }));
    expect(result.created).toBe(false);
    expect(result.result.duplicate).toBe(true);
  });
});
