import type { FlowError } from '../types';

/** 节点/工作流超时错误 */
export class RunTimeoutError extends Error {
  code = 'timeout';
  nodeId?: string;
  timeoutMs: number;

  constructor(message: string, timeoutMs: number, nodeId?: string) {
    super(message);
    this.name = 'RunTimeoutError';
    this.timeoutMs = timeoutMs;
    this.nodeId = nodeId;
  }
}

/** 执行被取消错误 */
export class RunCancelledError extends Error {
  code = 'cancelled';

  constructor(message = '执行已取消') {
    super(message);
    this.name = 'RunCancelledError';
  }
}

/** 判断是否为「人工确认」暂停请求 */
export function isConfirmError(err: unknown): err is FlowError {
  return (
    !!err &&
    typeof err === 'object' &&
    (err as FlowError).code === 'confirm_required'
  );
}

/** 判断是否为取消错误 */
export function isCancelledError(err: unknown): err is RunCancelledError {
  return (
    !!err &&
    typeof err === 'object' &&
    ((err as { code?: string }).code === 'cancelled' ||
      (err as Error).name === 'AbortError' ||
      (err as Error).name === 'RunCancelledError')
  );
}

/** 判断是否为超时错误 */
export function isTimeoutError(err: unknown): err is RunTimeoutError {
  return (
    !!err &&
    typeof err === 'object' &&
    ((err as { code?: string }).code === 'timeout' ||
      (err as Error).name === 'RunTimeoutError' ||
      (err as Error).name === 'TimeoutError')
  );
}

/** 统一提取可读错误信息 */
export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return String(err ?? '未知错误');
}
