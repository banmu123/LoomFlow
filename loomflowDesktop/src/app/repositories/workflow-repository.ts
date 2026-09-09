/**
 * WorkflowRepository — 工作流持久化抽象层
 *
 * UI 和业务层不应关心底层是 SQLite 还是 PostgreSQL。
 * Desktop: SQLiteWorkflowRepository
 * Web/Server: PostgresWorkflowRepository (Supabase)
 */

import type { TinyflowData } from '@/lib/tinyflow/types';

// ===== DTO =====

export interface WorkflowSummary {
  id: string;
  title: string;
  description: string | null;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRecord extends WorkflowSummary {
  data: TinyflowData;
}

export interface WorkflowVersionRecord {
  id: string;
  workflowId: string;
  version: number;
  title: string;
  description: string | null;
  data: TinyflowData;
  createdAt: string;
}

export interface ExecutionRecord {
  id: string;
  workflowId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
}

export interface ExecutionLogRecord {
  id: string;
  executionId: string;
  nodeId: string | null;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  createdAt: string;
}

export interface CreateWorkflowInput {
  title?: string;
  description?: string;
  data: TinyflowData;
}

export interface UpdateWorkflowInput {
  title?: string;
  description?: string;
  data?: TinyflowData;
}

// ===== Interface =====

export interface WorkflowRepository {
  // Workflow CRUD
  list(): Promise<WorkflowSummary[]>;
  get(id: string): Promise<WorkflowRecord | null>;
  create(input: CreateWorkflowInput): Promise<WorkflowRecord>;
  update(id: string, input: UpdateWorkflowInput): Promise<WorkflowRecord>;
  delete(id: string): Promise<void>;
  duplicate(id: string): Promise<WorkflowRecord>;

  // Versions
  listVersions(workflowId: string): Promise<WorkflowVersionRecord[]>;
  getVersion(workflowId: string, version: number): Promise<WorkflowVersionRecord | null>;

  // Executions
  listExecutions(workflowId?: string, limit?: number): Promise<ExecutionRecord[]>;
  getExecution(id: string): Promise<ExecutionRecord | null>;
  createExecution(workflowId: string, input: Record<string, unknown>): Promise<ExecutionRecord>;
  updateExecution(id: string, updates: Partial<Pick<ExecutionRecord, 'status' | 'output' | 'error' | 'completedAt' | 'durationMs'>>): Promise<void>;
  addExecutionLog(executionId: string, log: Omit<ExecutionLogRecord, 'id' | 'executionId' | 'createdAt'>): Promise<void>;
  getExecutionLogs(executionId: string): Promise<ExecutionLogRecord[]>;

  // Settings
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}
