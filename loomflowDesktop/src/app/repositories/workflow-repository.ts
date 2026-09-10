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

// ===== AI Model DTO =====

export interface AIModelRecord {
  id: string;
  provider: string;       // deepseek / openai / claude / gemini / qwen / ark / ollama / custom
  modelName: string;       // e.g. deepseek-chat, gpt-4o
  displayName: string | null;
  capabilities: string[];  // text / vision / tool
  baseUrl: string | null;
  apiKey: string | null;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAIModelInput {
  provider: string;
  modelName: string;
  displayName?: string;
  capabilities?: string[];
  baseUrl?: string;
  apiKey?: string;
  isEnabled?: boolean;
}

export interface UpdateAIModelInput {
  provider?: string;
  modelName?: string;
  displayName?: string;
  capabilities?: string[];
  baseUrl?: string;
  apiKey?: string;
  isEnabled?: boolean;
}

// ===== Conversation / Message DTO =====

export interface ConversationSummary {
  id: string;
  title: string;
  modelId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationRecord extends ConversationSummary {
  messages?: MessageRecord[];
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  modelId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// ===== Flow Event DTO =====

export interface FlowEventRecord {
  id: string;
  executionId: string;
  eventType: 'flow_start' | 'node_start' | 'node_complete' | 'node_error' | 'flow_complete' | 'flow_error';
  nodeId: string | null;
  nodeType: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
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

  // Flow Events (SSE 追踪)
  addFlowEvent(executionId: string, event: Omit<FlowEventRecord, 'id' | 'executionId' | 'createdAt'>): Promise<void>;
  getFlowEvents(executionId: string): Promise<FlowEventRecord[]>;

  // AI Models
  listModels(): Promise<AIModelRecord[]>;
  getEnabledModels(): Promise<AIModelRecord[]>;
  getModel(id: string): Promise<AIModelRecord | null>;
  createModel(input: CreateAIModelInput): Promise<AIModelRecord>;
  updateModel(id: string, input: UpdateAIModelInput): Promise<void>;
  deleteModel(id: string): Promise<void>;

  // Conversations
  listConversations(): Promise<ConversationSummary[]>;
  getConversation(id: string): Promise<ConversationRecord | null>;
  createConversation(title?: string, modelId?: string): Promise<ConversationRecord>;
  updateConversation(id: string, input: { title?: string; modelId?: string }): Promise<void>;
  deleteConversation(id: string): Promise<void>;

  // Messages
  listMessages(conversationId: string): Promise<MessageRecord[]>;
  createMessage(conversationId: string, role: MessageRecord['role'], content: string, metadata?: Record<string, unknown>, modelId?: string): Promise<MessageRecord>;
  deleteMessage(id: string): Promise<void>;

  // Settings
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}
