/* eslint-disable @typescript-eslint/no-explicit-any -- supabase 客户端无数据库类型定义 */
import { supabase } from '@/lib/supabase/server';
import type {
  CreateJobInput,
  FailJobInput,
  FlowJob,
  JobQueue,
  WorkerHeartbeatInput,
} from './types';

type Response<T> = { data: T; error: { code?: string; message: string } | null };

function firstRow<T>(rows: T[] | null): T | null {
  return rows && rows.length > 0 ? rows[0] : null;
}

/**
 * 基于 PostgreSQL 的任务队列（通过 PostgREST RPC 调用原子领取函数）。
 *
 * 为什么用 RPC 而不是直接 UPDATE：
 * PostgREST 的表操作无法表达 SELECT ... FOR UPDATE SKIP LOCKED，
 * 多个 Worker 并发领取会重复拿到同一任务。领取逻辑必须下推到数据库函数里。
 */
export class SupabaseJobQueue implements JobQueue {
  constructor(private readonly client: any = supabase) {}

  async createJob(input: CreateJobInput): Promise<{ job: FlowJob; duplicate: boolean }> {
    const row = {
      workflow_id: input.workflowId,
      user_id: input.userId ?? null,
      source: input.source ?? 'api',
      inputs: input.inputs ?? {},
      idempotency_key: input.idempotencyKey ?? null,
      max_attempts: input.maxAttempts ?? 3,
      workflow_hash: input.workflowHash ?? null,
      workflow_snapshot: input.workflowSnapshot ?? null,
      traceparent: input.traceparent ?? null,
    };

    const inserted: Response<FlowJob> = await this.client
      .from('flow_jobs')
      .insert(row)
      .select('*')
      .single();

    if (!inserted.error && inserted.data) {
      return { job: inserted.data, duplicate: false };
    }

    // 幂等键冲突：返回已存在的任务（同一业务请求不重复执行）
    if (inserted.error?.code === '23505' && row.idempotency_key) {
      const existing: Response<FlowJob[]> = await this.client
        .from('flow_jobs')
        .select('*')
        .eq('workflow_id', input.workflowId)
        .eq('idempotency_key', row.idempotency_key)
        .limit(1);

      const job = firstRow(existing.data);
      if (job) return { job, duplicate: true };
    }

    throw new Error(`任务创建失败: ${inserted.error?.message ?? 'unknown error'}`);
  }

  async claim(workerId: string, limit: number, leaseSeconds: number): Promise<FlowJob[]> {
    const { data, error } = await this.client.rpc('loomflow_claim_flow_jobs', {
      p_worker_id: workerId,
      p_limit: limit,
      p_lease_seconds: leaseSeconds,
    });
    if (error) throw new Error(`任务领取失败: ${error.message}`);
    return (data ?? []) as FlowJob[];
  }

  async heartbeat(jobId: string, workerId: string, leaseSeconds: number): Promise<boolean> {
    const now = new Date();
    const leaseExpires = new Date(now.getTime() + leaseSeconds * 1000);
    const { data, error } = await this.client
      .from('flow_jobs')
      .update({
        heartbeat_at: now.toISOString(),
        lease_expires_at: leaseExpires.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', jobId)
      .eq('locked_by', workerId)
      .eq('status', 'running')
      .select('id');
    if (error) return false;
    return (data ?? []).length > 0;
  }

  async setFlowId(jobId: string, workerId: string, flowId: string): Promise<void> {
    await this.client
      .from('flow_jobs')
      .update({ flow_id: flowId, updated_at: new Date().toISOString() })
      .eq('id', jobId)
      .eq('locked_by', workerId);
  }

  async saveCheckpoint(jobId: string, workerId: string, checkpoint: unknown): Promise<void> {
    await this.client
      .from('flow_jobs')
      .update({ checkpoint, updated_at: new Date().toISOString() })
      .eq('id', jobId)
      .eq('locked_by', workerId);
  }

  async complete(
    jobId: string,
    workerId: string,
    payload: { flowId: string; result?: unknown },
  ): Promise<boolean> {
    const now = new Date().toISOString();
    const { data, error } = await this.client
      .from('flow_jobs')
      .update({
        status: 'succeeded',
        flow_id: payload.flowId,
        result: payload.result ?? null,
        locked_by: null,
        locked_at: null,
        lease_expires_at: null,
        finished_at: now,
        updated_at: now,
        error_class: null,
        error_message: null,
      })
      .eq('id', jobId)
      .eq('locked_by', workerId)
      .eq('status', 'running')
      .select('id');
    if (error) return false;
    return (data ?? []).length > 0;
  }

  async cancelComplete(jobId: string, workerId: string): Promise<boolean> {
    const now = new Date().toISOString();
    const { data, error } = await this.client
      .from('flow_jobs')
      .update({
        status: 'cancelled',
        locked_by: null,
        locked_at: null,
        lease_expires_at: null,
        finished_at: now,
        updated_at: now,
      })
      .eq('id', jobId)
      .eq('locked_by', workerId)
      .in('status', ['running', 'cancel_requested'])
      .select('id');
    if (error) return false;
    return (data ?? []).length > 0;
  }

  async fail(jobId: string, workerId: string, input: FailJobInput): Promise<boolean> {
    const now = new Date();
    const status = input.deadLetter
      ? 'dead_letter'
      : input.retryable
        ? 'retrying'
        : 'failed';
    const { data, error } = await this.client
      .from('flow_jobs')
      .update({
        status,
        error_class: input.errorClass,
        error_message: input.errorMessage.slice(0, 2000),
        available_at: input.availableAt ?? now.toISOString(),
        locked_by: null,
        locked_at: null,
        lease_expires_at: null,
        finished_at: input.retryable ? null : now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', jobId)
      .eq('locked_by', workerId)
      .eq('status', 'running')
      .select('id');
    if (error) return false;
    return (data ?? []).length > 0;
  }

  async release(jobId: string, workerId: string): Promise<boolean> {
    const { data, error } = await this.client.rpc('loomflow_release_flow_job', {
      p_job_id: jobId,
      p_worker_id: workerId,
    });
    if (error) return false;
    return Boolean(data);
  }

  async getJobById(jobId: string): Promise<FlowJob | null> {
    const { data } = await this.client
      .from('flow_jobs')
      .select('*')
      .eq('id', jobId)
      .limit(1);
    return firstRow(data as FlowJob[] | null);
  }

  async getJobByFlowId(flowId: string): Promise<FlowJob | null> {
    const { data } = await this.client
      .from('flow_jobs')
      .select('*')
      .eq('flow_id', flowId)
      .limit(1);
    return firstRow(data as FlowJob[] | null);
  }

  async listJobsByWorkflow(workflowId: string, limit = 20): Promise<FlowJob[]> {
    const { data } = await this.client
      .from('flow_jobs')
      .select('*')
      .eq('workflow_id', workflowId)
      .order('created_at', { ascending: false })
      .limit(Math.min(limit, 100));
    return (data ?? []) as FlowJob[];
  }

  async requestCancel(jobId: string): Promise<FlowJob | null> {
    const { data, error } = await this.client.rpc('loomflow_cancel_flow_job', {
      p_job_id: jobId,
    });
    if (error) return null;
    return (data as FlowJob) ?? null;
  }

  async retryJob(jobId: string): Promise<FlowJob | null> {
    const { data, error } = await this.client.rpc('loomflow_requeue_flow_job', {
      p_job_id: jobId,
    });
    if (error) return null;
    return (data as FlowJob) ?? null;
  }

  async reapExpired(
    maxBackoffSeconds = 300,
  ): Promise<Array<{ job_id: string; new_status: string; attempts: number }>> {
    const { data, error } = await this.client.rpc('loomflow_reap_expired_flow_jobs', {
      p_max_backoff_seconds: maxBackoffSeconds,
    });
    if (error) throw new Error(`租约回收失败: ${error.message}`);
    return (data ?? []) as Array<{ job_id: string; new_status: string; attempts: number }>;
  }

  async touchWorker(info: WorkerHeartbeatInput): Promise<void> {
    const now = new Date().toISOString();
    await this.client.from('worker_heartbeats').upsert(
      {
        worker_id: info.workerId,
        hostname: info.hostname ?? null,
        version: info.version ?? null,
        concurrency: info.concurrency ?? null,
        last_seen_at: now,
        metadata: info.metadata ?? null,
      },
      { onConflict: 'worker_id' },
    );
  }
}
