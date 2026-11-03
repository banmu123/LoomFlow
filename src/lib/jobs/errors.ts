/**
 * 任务错误分类：决定「重试 / 直接失败 / 死信」。
 * 分类只影响队列调度，不改变原始错误信息（错误信息原样落库）。
 */

export type JobErrorClass =
  | 'sandbox_unavailable'
  | 'timeout'
  | 'cancelled'
  | 'workflow_not_found'
  | 'workflow_changed'
  | 'workflow_invalid'
  | 'awaiting_confirm'
  | 'worker_shutdown'
  | 'execution_error'
  | 'internal_error';

/** 明确不可重试的错误：重试只会得到同样结果 */
const NON_RETRYABLE: ReadonlySet<JobErrorClass> = new Set<JobErrorClass>([
  'workflow_not_found',
  'workflow_changed',
  'workflow_invalid',
  'awaiting_confirm',
]);

/** 可重试：沙箱暂时不可用、超时、未知执行异常 */
const RETRYABLE: ReadonlySet<JobErrorClass> = new Set<JobErrorClass>([
  'sandbox_unavailable',
  'timeout',
  'worker_shutdown',
  'execution_error',
  'internal_error',
]);

export class JobError extends Error {
  readonly errorClass: JobErrorClass;
  readonly retryable: boolean;

  constructor(errorClass: JobErrorClass, message: string, retryable?: boolean) {
    super(message);
    this.name = 'JobError';
    this.errorClass = errorClass;
    this.retryable = retryable ?? RETRYABLE.has(errorClass);
  }
}

export function isJobError(err: unknown): err is JobError {
  return err instanceof JobError;
}

/** 把任意异常归类为任务错误；未知异常默认可重试（避免一次性丢弃任务） */
export function classifyJobError(err: unknown): {
  errorClass: JobErrorClass;
  message: string;
  retryable: boolean;
} {
  if (err instanceof JobError) {
    return { errorClass: err.errorClass, message: err.message, retryable: err.retryable };
  }

  const e = err as { message?: string; code?: string; name?: string } | null;
  const message = e?.message || String(err ?? '未知错误');
  const code = String(e?.code || '');
  const name = String(e?.name || '');

  if (code === 'sandbox_unavailable') {
    return { errorClass: 'sandbox_unavailable', message, retryable: true };
  }
  if (code === 'timeout' || name === 'RunTimeoutError' || name === 'TimeoutError') {
    return { errorClass: 'timeout', message, retryable: true };
  }
  if (code === 'cancelled' || name === 'RunCancelledError' || name === 'AbortError') {
    return { errorClass: 'cancelled', message, retryable: false };
  }

  return {
    errorClass: 'execution_error',
    message,
    // 未知执行异常默认可重试：避免一次抖动就把任务丢进死信
    retryable: true,
  };
}
