import { describe, it, expect, vi } from 'vitest';
import { WorkerRuntime } from '../worker-runtime';
import { JobError } from '../errors';
import type {
  CreateJobInput,
  FailJobInput,
  FlowJob,
  JobQueue,
  WorkerHeartbeatInput,
} from '../types';

function makeJob(overrides: Partial<FlowJob> = {}): FlowJob {
  const now = new Date().toISOString();
  return {
    id: 'job-1',
    workflow_id: 'wf-1',
    user_id: 'user-1',
    source: 'api',
    status: 'running',
    inputs: { q: 'hello' },
    idempotency_key: null,
    attempts: 1,
    max_attempts: 3,
    available_at: now,
    locked_by: 'worker-1',
    locked_at: now,
    lease_expires_at: now,
    heartbeat_at: now,
    flow_id: null,
    workflow_hash: null,
    workflow_snapshot: null,
    checkpoint: null,
    resume_checkpoint: null,
    cancel_requested_at: null,
    error_class: null,
    error_message: null,
    result: null,
    created_at: now,
    updated_at: now,
    started_at: now,
    finished_at: null,
    ...overrides,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeQueue {
  claimResults: FlowJob[][] = [];
  currentJob: FlowJob | null = null;

  completed: Array<{ id: string; payload: { flowId: string; result?: unknown } }> = [];
  failed: Array<{ id: string; input: FailJobInput }> = [];
  released: string[] = [];
  cancelled: string[] = [];
  flowIds = new Map<string, string>();
  checkpoints: unknown[] = [];
  heartbeats: string[] = [];
  reaped = 0;
  touchCount = 0;

  async createJob(_input: CreateJobInput) {
    return { job: makeJob(), duplicate: false };
  }

  async claim(_workerId: string, limit: number): Promise<FlowJob[]> {
    const batch = this.claimResults.shift() ?? [];
    return batch.slice(0, limit);
  }

  async heartbeat(jobId: string): Promise<boolean> {
    this.heartbeats.push(jobId);
    return true;
  }

  async setFlowId(jobId: string, _workerId: string, flowId: string): Promise<void> {
    this.flowIds.set(jobId, flowId);
  }

  async saveCheckpoint(_jobId: string, _workerId: string, checkpoint: unknown): Promise<void> {
    this.checkpoints.push(checkpoint);
  }

  async complete(
    jobId: string,
    _workerId: string,
    payload: { flowId: string; result?: unknown },
  ): Promise<boolean> {
    this.completed.push({ id: jobId, payload });
    return true;
  }

  async cancelComplete(jobId: string): Promise<boolean> {
    this.cancelled.push(jobId);
    return true;
  }

  async fail(jobId: string, _workerId: string, input: FailJobInput): Promise<boolean> {
    this.failed.push({ id: jobId, input });
    return true;
  }

  async release(jobId: string): Promise<boolean> {
    this.released.push(jobId);
    return true;
  }

  async getJobById(): Promise<FlowJob | null> {
    return this.currentJob;
  }

  async getJobByFlowId(): Promise<FlowJob | null> {
    return null;
  }

  async listJobsByWorkflow(): Promise<FlowJob[]> {
    return [];
  }

  async requestCancel(): Promise<FlowJob | null> {
    return null;
  }

  async retryJob(): Promise<FlowJob | null> {
    return null;
  }

  async reapExpired(): Promise<Array<{ job_id: string; new_status: string; attempts: number }>> {
    this.reaped += 1;
    return [];
  }

  async touchWorker(_info: WorkerHeartbeatInput): Promise<void> {
    this.touchCount += 1;
  }
}

function asQueue(fake: FakeQueue): JobQueue {
  return fake as unknown as JobQueue;
}

describe('WorkerRuntime 任务执行', () => {
  it('成功执行后写回 succeeded 并记录 flowId', async () => {
    const queue = new FakeQueue();
    const runtime = new WorkerRuntime({
      queue: asQueue(queue),
      workerId: 'worker-1',
      runner: async () => ({ flowId: 'flow-1', status: 'completed', outputs: { answer: 42 } }),
    });

    await runtime.executeJob(makeJob());

    expect(queue.flowIds.get('job-1')).toBeTruthy();
    expect(queue.completed).toHaveLength(1);
    expect(queue.completed[0].payload).toMatchObject({ flowId: 'flow-1', result: { answer: 42 } });
    expect(runtime.stats.succeeded).toBe(1);
  });

  it('可重试失败进入 retrying 并携带退避时间', async () => {
    const queue = new FakeQueue();
    const runtime = new WorkerRuntime({
      queue: asQueue(queue),
      workerId: 'worker-1',
      runner: async () => {
        throw new Error('upstream 503');
      },
    });

    await runtime.executeJob(makeJob({ attempts: 1, max_attempts: 3 }));

    expect(queue.failed).toHaveLength(1);
    expect(queue.failed[0].input.retryable).toBe(true);
    expect(queue.failed[0].input.errorClass).toBe('execution_error');
    expect(new Date(queue.failed[0].input.availableAt!).getTime()).toBeGreaterThan(Date.now());
    expect(runtime.stats.retried).toBe(1);
  });

  it('次数耗尽后进入死信队列', async () => {
    const queue = new FakeQueue();
    const runtime = new WorkerRuntime({
      queue: asQueue(queue),
      workerId: 'worker-1',
      runner: async () => {
        throw new Error('still failing');
      },
    });

    await runtime.executeJob(makeJob({ attempts: 3, max_attempts: 3 }));

    expect(queue.failed[0].input).toMatchObject({ retryable: false, deadLetter: true });
    expect(runtime.stats.failed).toBe(1);
  });

  it('不可重试错误直接 failed（不占死信）', async () => {
    const queue = new FakeQueue();
    const runtime = new WorkerRuntime({
      queue: asQueue(queue),
      workerId: 'worker-1',
      runner: async () => {
        throw new JobError('workflow_changed', '工作流已修改');
      },
    });

    await runtime.executeJob(makeJob());

    expect(queue.failed[0].input).toMatchObject({
      retryable: false,
      deadLetter: false,
      errorClass: 'workflow_changed',
    });
  });

  it('取消请求会中止执行并落为 cancelled', async () => {
    const queue = new FakeQueue();
    queue.currentJob = makeJob({ status: 'cancel_requested' });

    const runtime = new WorkerRuntime({
      queue: asQueue(queue),
      workerId: 'worker-1',
      cancelPollIntervalMs: 200,
      runner: async (_job, ctx) =>
        new Promise((_resolve, reject) => {
          ctx.signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    });

    const running = runtime.executeJob(makeJob());
    await sleep(350);
    await running;

    expect(queue.cancelled).toContain('job-1');
    expect(runtime.stats.cancelled).toBe(1);
  });

  it('暂停（人工确认）在异步模式下明确失败', async () => {
    const queue = new FakeQueue();
    const runtime = new WorkerRuntime({
      queue: asQueue(queue),
      workerId: 'worker-1',
      runner: async () => ({ flowId: 'f', status: 'paused' }),
    });

    await runtime.executeJob(makeJob());

    expect(queue.failed[0].input.errorClass).toBe('awaiting_confirm');
    expect(queue.failed[0].input.retryable).toBe(false);
  });
});

describe('WorkerRuntime 生命周期', () => {
  it('优雅关闭会等待在途任务完成', async () => {
    const queue = new FakeQueue();
    queue.claimResults = [[makeJob()]];

    const runtime = new WorkerRuntime({
      queue: asQueue(queue),
      workerId: 'worker-1',
      concurrency: 1,
      pollIntervalMs: 100,
      shutdownGraceMs: 2000,
      runner: async (job) => {
        await sleep(150);
        return { flowId: 'flow-slow', status: 'completed' };
      },
    });

    await runtime.start();
    await sleep(40);
    await runtime.stop();

    expect(queue.completed).toHaveLength(1);
    expect(queue.released).toHaveLength(0);
  });

  it('超过优雅关闭窗口则中止并归还任务（不消耗重试次数）', async () => {
    const queue = new FakeQueue();
    queue.claimResults = [[makeJob()]];

    const runtime = new WorkerRuntime({
      queue: asQueue(queue),
      workerId: 'worker-1',
      concurrency: 1,
      pollIntervalMs: 100,
      shutdownGraceMs: 50,
      runner: async (_job, ctx) =>
        new Promise((_resolve, reject) => {
          ctx.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });

    await runtime.start();
    await sleep(40);
    await runtime.stop();

    expect(queue.released).toContain('job-1');
    expect(queue.failed).toHaveLength(0);
  });

  it('关闭中止时引擎返回 cancelled 也应归还任务，而不是落为取消终态', async () => {
    const queue = new FakeQueue();
    queue.claimResults = [[makeJob()]];

    const runtime = new WorkerRuntime({
      queue: asQueue(queue),
      workerId: 'worker-1',
      concurrency: 1,
      pollIntervalMs: 100,
      shutdownGraceMs: 50,
      runner: async (_job, ctx) =>
        new Promise((resolve) => {
          ctx.signal.addEventListener('abort', () =>
            resolve({ flowId: 'flow-aborted', status: 'cancelled' as const }),
          );
        }),
    });

    await runtime.start();
    await sleep(40);
    await runtime.stop();

    expect(queue.released).toContain('job-1');
    expect(queue.cancelled).toHaveLength(0);
  });

  it('并发上限生效', async () => {
    const queue = new FakeQueue();
    queue.claimResults = [[makeJob({ id: 'a' }), makeJob({ id: 'b' })]];

    let active = 0;
    let maxActive = 0;

    const runtime = new WorkerRuntime({
      queue: asQueue(queue),
      workerId: 'worker-1',
      concurrency: 1,
      pollIntervalMs: 100,
      shutdownGraceMs: 1000,
      runner: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await sleep(60);
        active -= 1;
        return { flowId: 'f', status: 'completed' };
      },
    });

    await runtime.start();
    await sleep(220);
    await runtime.stop();

    expect(maxActive).toBe(1);
    expect(queue.completed.length).toBeGreaterThanOrEqual(1);
  });

  it('租约丢失时不视为成功（complete 返回 false 仅告警）', async () => {
    const queue = new FakeQueue();
    const warn = vi.fn();
    queue.complete = async () => false;

    const runtime = new WorkerRuntime({
      queue: asQueue(queue),
      workerId: 'worker-1',
      logger: { info: () => {}, warn, error: () => {} },
      runner: async () => ({ flowId: 'f', status: 'completed' }),
    });

    await runtime.executeJob(makeJob());

    expect(warn).toHaveBeenCalled();
  });
});
