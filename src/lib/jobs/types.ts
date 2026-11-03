/**
 * 持久化任务队列的数据模型。
 * 与 scripts/supabase-updates.sql 中的 flow_jobs 表一一对应。
 */

export type JobStatus =
  | 'queued'
  | 'running'
  | 'retrying'
  | 'succeeded'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled'
  | 'dead_letter';

/** 终态：不再被领取，也不会再变化（手动重试除外） */
export const TERMINAL_JOB_STATUSES: JobStatus[] = [
  'succeeded',
  'failed',
  'cancelled',
  'dead_letter',
];

export function isTerminalJobStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

export interface FlowJob {
  id: string;
  workflow_id: string;
  user_id: string | null;
  source: string;
  status: JobStatus;
  inputs: Record<string, unknown>;
  idempotency_key: string | null;
  /** W3C traceparent（提交时注入，Worker 恢复链路） */
  traceparent: string | null;
  attempts: number;
  max_attempts: number;
  available_at: string;
  locked_by: string | null;
  locked_at: string | null;
  lease_expires_at: string | null;
  heartbeat_at: string | null;
  flow_id: string | null;
  workflow_hash: string | null;
  /** 提交时的执行快照（JSON），避免排队期间工作流被改动导致执行内容漂移 */
  workflow_snapshot: Record<string, unknown> | null;
  checkpoint: Record<string, unknown> | null;
  resume_checkpoint: Record<string, unknown> | null;
  cancel_requested_at: string | null;
  error_class: string | null;
  error_message: string | null;
  result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface CreateJobInput {
  workflowId: string;
  userId?: string | null;
  source?: string;
  inputs?: Record<string, unknown>;
  idempotencyKey?: string | null;
  maxAttempts?: number;
  workflowHash?: string | null;
  /** 受理时的执行快照（发布 API 传 published_data） */
  workflowSnapshot?: Record<string, unknown> | null;
  /** 提交时捕获的 W3C traceparent（异步任务跨进程链路） */
  traceparent?: string | null;
}

export interface FailJobInput {
  errorClass: string;
  errorMessage: string;
  /** true = 进入 retrying（按 availableAt 重试）；false = 直接 failed / dead_letter */
  retryable: boolean;
  /** 可重试但已耗尽次数时进入死信队列 */
  deadLetter?: boolean;
  /** 下一次可执行时间（ISO）；不传则由调用方计算后退避 */
  availableAt?: string;
}

/** Worker 侧依赖的最小队列接口（便于单测注入内存实现） */
export interface JobQueue {
  createJob(input: CreateJobInput): Promise<{ job: FlowJob; duplicate: boolean }>;
  claim(workerId: string, limit: number, leaseSeconds: number): Promise<FlowJob[]>;
  heartbeat(jobId: string, workerId: string, leaseSeconds: number): Promise<boolean>;
  setFlowId(jobId: string, workerId: string, flowId: string): Promise<void>;
  saveCheckpoint(jobId: string, workerId: string, checkpoint: unknown): Promise<void>;
  complete(jobId: string, workerId: string, payload: { flowId: string; result?: unknown }): Promise<boolean>;
  cancelComplete(jobId: string, workerId: string): Promise<boolean>;
  fail(jobId: string, workerId: string, input: FailJobInput): Promise<boolean>;
  /** 优雅关闭：归还任务且不消耗重试次数 */
  release(jobId: string, workerId: string): Promise<boolean>;
  getJobById(jobId: string): Promise<FlowJob | null>;
  getJobByFlowId(flowId: string): Promise<FlowJob | null>;
  listJobsByWorkflow(workflowId: string, limit?: number): Promise<FlowJob[]>;
  requestCancel(jobId: string): Promise<FlowJob | null>;
  retryJob(jobId: string): Promise<FlowJob | null>;
  reapExpired(maxBackoffSeconds?: number): Promise<Array<{ job_id: string; new_status: string; attempts: number }>>;
  touchWorker(info: WorkerHeartbeatInput): Promise<void>;
}

export interface WorkerHeartbeatInput {
  workerId: string;
  hostname?: string;
  version?: string;
  concurrency?: number;
  metadata?: Record<string, unknown>;
}

/** 队列状态 → 对外 API 状态（保持与旧接口的 status 语义一致） */
export function jobStatusToApiStatus(
  status: JobStatus,
): 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' {
  switch (status) {
    case 'queued':
    case 'retrying':
      return 'queued';
    case 'running':
    case 'cancel_requested':
      return 'running';
    case 'succeeded':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'failed':
    case 'dead_letter':
    default:
      return 'failed';
  }
}
