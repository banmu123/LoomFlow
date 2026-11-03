/**
 * 独立 Worker 进程：node dist/worker.js
 *
 * 职责：从 flow_jobs 领取任务 → 用同一套 FlowEngine 执行 → 写回状态。
 * 与 Web API 共享业务代码，但不共享进程内状态（可多副本部署）。
 */

import { hostname } from 'node:os';
import { supabase } from '@/lib/supabase/server';
import { runFlow } from '@/lib/tinyflow/runFlow';
import type { TinyflowData } from '@/lib/tinyflow/types';
import { computeHash } from '@/lib/workflow-hash';
import { initTelemetry, shutdownTelemetry } from '@/lib/telemetry';
import {
  JobError,
  SupabaseJobQueue,
  WorkerRuntime,
  type JobRunner,
  type WorkerLogger,
} from '@/lib/jobs';

const logger: WorkerLogger = {
  info: (message, meta) => console.log(`[worker] ${message}`, meta ?? ''),
  warn: (message, meta) => console.warn(`[worker] ${message}`, meta ?? ''),
  error: (message, meta) => console.error(`[worker] ${message}`, meta ?? ''),
};

initTelemetry('loomflow-worker');

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const workerId =
  process.env.WORKER_ID || `${hostname()}-${process.pid}`;

const queue = new SupabaseJobQueue(supabase);

/**
 * 任务执行器：确定执行内容 → 校验版本 → 执行（可带 checkpoint 恢复）。
 *
 * 执行内容优先级：
 *   1. job.workflow_snapshot —— 受理时固化的快照（发布 API 的 published_data），
 *      排队期间工作流被编辑/重新发布都不会改变本次执行；
 *   2. 兼容早期任务：回读 workflow_history（source=api 用 published_data，其余用 data）。
 *
 * 为什么校验 workflow_hash：任务排队期间工作流可能被编辑，
 * 用旧 checkpoint 恢复新结构会得到不可预期的执行路径，宁可明确失败。
 */
const runner: JobRunner = async (job, ctx) => {
  let flowData: TinyflowData;

  if (job.workflow_snapshot) {
    if (job.workflow_hash && computeHash(job.workflow_snapshot) !== job.workflow_hash) {
      throw new JobError('workflow_changed', '任务快照校验失败，已放弃执行');
    }
    flowData = job.workflow_snapshot as unknown as TinyflowData;
  } else {
    const { data: workflow, error } = await supabase
      .from('workflow_history')
      .select('data, published_data')
      .eq('id', job.workflow_id)
      .single();

    if (error || !workflow) {
      throw new JobError('workflow_not_found', `工作流不存在或已被删除：${job.workflow_id}`);
    }

    const source =
      job.source === 'api' ? (workflow.published_data ?? workflow.data) : workflow.data;

    if (!source) {
      throw new JobError('workflow_not_found', `工作流没有可执行内容：${job.workflow_id}`);
    }
    if (job.workflow_hash && computeHash(source) !== job.workflow_hash) {
      throw new JobError(
        'workflow_changed',
        '工作流在排队期间已被修改，已放弃本次恢复执行（避免用旧 checkpoint 跑新结构）',
      );
    }
    flowData = source as TinyflowData;
  }

  // 首次尝试不带 checkpoint；重试时从最近一次节点完成点恢复
  const resumeCheckpoint =
    job.resume_checkpoint ?? (job.attempts > 1 ? job.checkpoint : null);

  const result = await runFlow(flowData, job.inputs ?? {}, {
    source: 'worker',
    workflowId: job.workflow_id,
    userId: job.user_id,
    flowId: ctx.flowId,
    jobId: job.id,
    signal: ctx.signal,
    resumeCheckpoint: resumeCheckpoint ?? undefined,
    onCheckpoint: ctx.onCheckpoint,
  });

  return {
    flowId: result.flowId,
    status:
      result.status === 'running'
        ? 'failed'
        : (result.status as 'completed' | 'failed' | 'cancelled' | 'timeout' | 'paused'),
    outputs: result.outputs,
    error: result.error,
  };
};

const runtime = new WorkerRuntime({
  queue,
  workerId,
  runner,
  concurrency: intFromEnv('WORKER_CONCURRENCY', 2),
  leaseSeconds: intFromEnv('WORKER_LEASE_SECONDS', 60),
  pollIntervalMs: intFromEnv('WORKER_POLL_INTERVAL_MS', 1000),
  heartbeatIntervalMs: intFromEnv('WORKER_HEARTBEAT_INTERVAL_MS', 15000),
  shutdownGraceMs: intFromEnv('WORKER_SHUTDOWN_GRACE_MS', 30000),
  maxBackoffMs: intFromEnv('WORKER_MAX_BACKOFF_MS', 300000),
  hostname: hostname(),
  version: process.env.npm_package_version,
  logger,
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`received ${signal}, shutting down gracefully`);
  try {
    await runtime.stop();
    await shutdownTelemetry();
    process.exit(0);
  } catch (err) {
    console.error('[worker] shutdown failed', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  console.error('[worker] unhandled rejection', reason);
});

logger.info('booting', {
  workerId,
  concurrency: intFromEnv('WORKER_CONCURRENCY', 2),
  leaseSeconds: intFromEnv('WORKER_LEASE_SECONDS', 60),
});

runtime.start().catch((err) => {
  console.error('[worker] failed to start', err);
  process.exit(1);
});
