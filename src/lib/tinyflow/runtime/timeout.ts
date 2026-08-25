import { RunTimeoutError } from './errors';

/** 可中止的延时（用于重试退避；中止时抛取消错误） */
export function sleep(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal.reason));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError(signal?.reason));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(reason?: unknown): Error {
  if (reason instanceof Error) return reason;
  const err = new Error(String(reason || 'Aborted'));
  err.name = 'AbortError';
  return err;
}

/**
 * Promise 超时包装：超时后拒绝为 RunTimeoutError。
 * ms <= 0 视为无超时，原样返回。
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
  nodeId?: string,
): Promise<T> {
  if (ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new RunTimeoutError(message, ms, nodeId));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
