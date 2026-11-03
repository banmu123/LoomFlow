import { randomUUID } from 'node:crypto';
import { computeBackoffMs, hasAttemptsLeft } from './backoff';
import { JobError, classifyJobError } from './errors';
import type { FlowJob, JobQueue } from './types';

export interface JobExecutionResult {
  flowId: string;
  status: 'completed' | 'failed' | 'cancelled' | 'timeout' | 'paused';
  outputs?: unknown;
  error?: string;
}

export interface JobRunContext {
  /** 工作流执行 id（同时作为 trace id） */
  flowId: string;
  /** 取消信号：用户取消 / Worker 关闭都会 abort */
  signal: AbortSignal;
  /** 每完成一个节点回调一次，用于任务级 checkpoint */
  onCheckpoint: (checkpoint: unknown) => void;
}

export type JobRunner = (job: FlowJob, ctx: JobRunContext) => Promise<JobExecutionResult>;

export interface WorkerLogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

export interface WorkerRuntimeOptions {
  queue: JobQueue;
  workerId: string;
  runner: JobRunner;
  concurrency?: number;
  leaseSeconds?: number;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  cancelPollIntervalMs?: number;
  reapIntervalMs?: number;
  shutdownGraceMs?: number;
  maxBackoffMs?: number;
  hostname?: string;
  version?: string;
  logger?: WorkerLogger;
  /** 便于测试注入 */
  sleep?: (ms: number) => Promise<void>;
}

interface ActiveJob {
  controller: AbortController;
  promise: Promise<void>;
}

const quietLogger: WorkerLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Worker 关闭时 abort 的原因标记（与用户取消区分） */
export class WorkerShutdownError extends Error {
  readonly code = 'worker_shutdown';
  constructor(message = 'worker is shutting down') {
    super(message);
    this.name = 'WorkerShutdownError';
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Worker 运行时：领取 → 执行 → 结算，配合数据库租约实现崩溃自愈。
 *
 * 交付语义：at-least-once。
 * - 领取是原子的（SKIP LOCKED），同一时刻只有一个 Worker 持有租约；
 * - Worker 崩溃后租约过期，任务被重新领取，**可能重复执行**；
 * - 通过 idempotency_key 去重提交、通过 checkpoint 跳过已完成节点来收敛重复副作用；
 * - 不宣称 exactly-once：外部 HTTP 等副作用无法由队列单方面保证。
 */
export class WorkerRuntime {
  private readonly queue: JobQueue;
  private readonly workerId: string;
  private readonly runner: JobRunner;
  private readonly concurrency: number;
  private readonly leaseSeconds: number;
  private readonly pollIntervalMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly cancelPollIntervalMs: number;
  private readonly reapIntervalMs: number;
  private readonly shutdownGraceMs: number;
  private readonly maxBackoffMs: number;
  private readonly logger: WorkerLogger;
  private readonly sleep: (ms: number) => Promise<void>;

  private running = false;
  private stopping = false;
  private loopPromise: Promise<void> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastReapAt = 0;
  private readonly active = new Map<string, ActiveJob>();

  readonly stats = {
    claimed: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    retried: 0,
    reaped: 0,
  };

  constructor(options: WorkerRuntimeOptions) {
    this.queue = options.queue;
    this.workerId = options.workerId;
    this.runner = options.runner;
    this.concurrency = Math.max(1, Math.min(options.concurrency ?? 2, 32));
    this.leaseSeconds = Math.max(10, options.leaseSeconds ?? 60);
    this.pollIntervalMs = Math.max(100, options.pollIntervalMs ?? 1000);
    this.heartbeatIntervalMs = Math.max(1000, options.heartbeatIntervalMs ?? 15_000);
    this.cancelPollIntervalMs = Math.max(200, options.cancelPollIntervalMs ?? 2000);
    this.reapIntervalMs = Math.max(1000, options.reapIntervalMs ?? 60_000);
    this.shutdownGraceMs = Math.max(0, options.shutdownGraceMs ?? 30_000);
    this.maxBackoffMs = Math.max(1000, options.maxBackoffMs ?? 300_000);
    this.logger = options.logger ?? quietLogger;
    this.sleep = options.sleep ?? defaultSleep;

    void options.hostname;
    void options.version;
  }

  get activeCount(): number {
    return this.active.size;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopping = false;

    await this.safeTouchWorker();
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat();
    }, this.heartbeatIntervalMs);
    // 不阻止进程退出（stop 时会清理）
    this.heartbeatTimer.unref?.();

    this.logger.info('worker started', {
      workerId: this.workerId,
      concurrency: this.concurrency,
      leaseSeconds: this.leaseSeconds,
    });

    this.loopPromise = this.loop();
  }

  /** 优雅关闭：停止领取 → 等待在途任务 → 超时则中止并归还任务 */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.stopping = true;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    const inflight = [...this.active.values()].map((a) => a.promise);
    if (inflight.length > 0) {
      this.logger.info('waiting for in-flight jobs', { count: inflight.length, graceMs: this.shutdownGraceMs });
      await Promise.race([
        Promise.allSettled(inflight),
        this.sleep(this.shutdownGraceMs),
      ]);
    }

    // 仍未完成：中止执行，任务由 catch 分支归还队列（不消耗重试次数）
    for (const [, job] of this.active) {
      if (!job.controller.signal.aborted) {
        job.controller.abort(new WorkerShutdownError());
      }
    }
    await Promise.allSettled([...this.active.values()].map((a) => a.promise));

    await this.loopPromise?.catch(() => {});
    this.loopPromise = null;
    this.logger.info('worker stopped', { ...this.stats });
  }

  /** 单轮执行（测试与手动调度使用）：领取一批并串行执行完 */
  async runOnce(limit = this.concurrency): Promise<number> {
    const jobs = await this.claimSafely(limit);
    for (const job of jobs) {
      await this.executeJob(job);
    }
    return jobs.length;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        if (Date.now() - this.lastReapAt >= this.reapIntervalMs) {
          this.lastReapAt = Date.now();
          await this.reapSafely();
        }

        const free = this.concurrency - this.active.size;
        if (free <= 0) {
          await this.sleep(this.pollIntervalMs);
          continue;
        }

        const jobs = await this.claimSafely(free);
        if (jobs.length === 0) {
          await this.sleep(this.pollIntervalMs);
          continue;
        }

        for (const job of jobs) {
          this.dispatch(job);
        }
      } catch (err) {
        this.logger.error('worker loop error', { error: (err as Error).message });
        await this.sleep(this.pollIntervalMs);
      }
    }
  }

  private dispatch(job: FlowJob): void {
    const controller = new AbortController();
    const promise = this.executeJob(job, controller).finally(() => {
      this.active.delete(job.id);
    });
    this.active.set(job.id, { controller, promise });
  }

  /** 执行并结算单个任务；永不抛出（错误已转为任务状态） */
  async executeJob(job: FlowJob, controller = new AbortController()): Promise<void> {
    this.stats.claimed += 1;

    // 每次尝试使用独立 flowId：保留每次执行的 trace/事件，不覆盖上一次尝试的记录
    const flowId = randomUUID();
    let cancelTimer: ReturnType<typeof setInterval> | null = null;

    try {
      await this.queue.setFlowId(job.id, this.workerId, flowId);

      // 轮询取消请求：任务可能被 API 标记为 cancel_requested
      cancelTimer = setInterval(() => {
        void this.queue
          .getJobById(job.id)
          .then((latest) => {
            if (latest?.status === 'cancel_requested' && !controller.signal.aborted) {
              controller.abort(new JobError('cancelled', '任务已取消'));
            }
          })
          .catch(() => {});
      }, this.cancelPollIntervalMs);
      cancelTimer.unref?.();

      const result = await this.runner(job, {
        flowId,
        signal: controller.signal,
        onCheckpoint: (checkpoint) => {
          void this.queue.saveCheckpoint(job.id, this.workerId, checkpoint).catch(() => {});
        },
      });

      if (result.status === 'completed') {
        const ok = await this.queue.complete(job.id, this.workerId, {
          flowId: result.flowId,
          result: result.outputs,
        });
        if (!ok) this.logger.warn('job completed but lease was lost', { jobId: job.id });
        this.stats.succeeded += 1;
        return;
      }

      // Worker 关闭导致的中止：归还任务，不能当成"用户取消"落终态
      if (this.isShutdownAbort(controller)) {
        await this.queue.release(job.id, this.workerId);
        this.logger.info('job released for shutdown', { jobId: job.id });
        return;
      }

      if (result.status === 'cancelled') {
        await this.queue.cancelComplete(job.id, this.workerId);
        this.stats.cancelled += 1;
        return;
      }

      if (result.status === 'paused') {
        throw new JobError(
          'awaiting_confirm',
          '工作流在人工确认节点暂停；异步/Worker 模式暂不支持人工确认，请改用同步执行',
        );
      }

      throw new JobError(
        result.status === 'timeout' ? 'timeout' : 'execution_error',
        result.error || `工作流执行结束状态：${result.status}`,
      );
    } catch (err) {
      await this.settleFailure(job, controller, err);
    } finally {
      if (cancelTimer) clearInterval(cancelTimer);
    }
  }

  private async settleFailure(
    job: FlowJob,
    controller: AbortController,
    err: unknown,
  ): Promise<void> {
    // Worker 关闭：归还任务，不消耗重试次数
    if (this.isShutdownAbort(controller)) {
      await this.queue.release(job.id, this.workerId);
      this.logger.info('job released for shutdown', { jobId: job.id });
      return;
    }

    const classified = classifyJobError(err);

    if (classified.errorClass === 'cancelled') {
      await this.queue.cancelComplete(job.id, this.workerId);
      this.stats.cancelled += 1;
      return;
    }

    const canRetry =
      classified.retryable && hasAttemptsLeft(job.attempts, job.max_attempts);

    if (canRetry) {
      const availableAt = new Date(
        Date.now() + computeBackoffMs(job.attempts, { maxMs: this.maxBackoffMs }),
      ).toISOString();
      await this.queue.fail(job.id, this.workerId, {
        errorClass: classified.errorClass,
        errorMessage: classified.message,
        retryable: true,
        availableAt,
      });
      this.stats.retried += 1;
      this.logger.warn('job scheduled for retry', {
        jobId: job.id,
        attempt: job.attempts,
        maxAttempts: job.max_attempts,
        errorClass: classified.errorClass,
      });
      return;
    }

    await this.queue.fail(job.id, this.workerId, {
      errorClass: classified.errorClass,
      errorMessage: classified.message,
      retryable: false,
      deadLetter: classified.retryable,
    });
    this.stats.failed += 1;
    this.logger.error('job failed permanently', {
      jobId: job.id,
      errorClass: classified.errorClass,
      error: classified.message,
    });
  }

  private isShutdownAbort(controller: AbortController): boolean {
    return controller.signal.aborted && controller.signal.reason instanceof WorkerShutdownError;
  }

  private async claimSafely(limit: number): Promise<FlowJob[]> {
    try {
      return await this.queue.claim(this.workerId, limit, this.leaseSeconds);
    } catch (err) {
      this.logger.error('claim failed', { error: (err as Error).message });
      return [];
    }
  }

  private async reapSafely(): Promise<void> {
    try {
      const reaped = await this.queue.reapExpired(Math.floor(this.maxBackoffMs / 1000));
      if (reaped.length > 0) {
        this.stats.reaped += reaped.length;
        this.logger.warn('reaped expired job leases', { count: reaped.length });
      }
    } catch (err) {
      this.logger.warn('reap failed', { error: (err as Error).message });
    }
  }

  private async heartbeat(): Promise<void> {
    await this.safeTouchWorker();
    // 续租：只对当前 Worker 持有的任务生效
    for (const jobId of this.active.keys()) {
      await this.queue.heartbeat(jobId, this.workerId, this.leaseSeconds).catch(() => false);
    }
  }

  private async safeTouchWorker(): Promise<void> {
    try {
      await this.queue.touchWorker({
        workerId: this.workerId,
        concurrency: this.concurrency,
      });
    } catch {
      // 心跳失败不阻断执行
    }
  }
}
