/**
 * SQLiteWorkflowRepository — Desktop 端 SQLite 实现
 *
 * 通过 @tauri-apps/plugin-sql 操作本地 SQLite 数据库。
 * 所有数据落盘在用户本地，完全离线可用。
 */

import Database from '@tauri-apps/plugin-sql';
import type {
  WorkflowRepository,
  WorkflowSummary,
  WorkflowRecord,
  WorkflowVersionRecord,
  ExecutionRecord,
  ExecutionLogRecord,
  CreateWorkflowInput,
  UpdateWorkflowInput,
  AIModelRecord,
  CreateAIModelInput,
  UpdateAIModelInput,
  ConversationSummary,
  ConversationRecord,
  MessageRecord,
  FlowEventRecord,
} from './workflow-repository';
import type { TinyflowData } from '@/lib/tinyflow/types';

// ===== UUID generation (no external dependency) =====
function uuid(): string {
  return crypto.randomUUID();
}

function nowISO(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

// ===== Helper: parse JSON data field =====
function parseData(raw: string): TinyflowData {
  try {
    return JSON.parse(raw) as TinyflowData;
  } catch {
    return { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
  }
}

// ===== Singleton DB connection with retry =====
// Tauri-plugin-sql runs migrations on startup which may briefly lock the DB.
// Retry with backoff to handle the initial lock.
let _db: Database | null = null;

async function getDb(): Promise<Database> {
  if (_db) return _db;

  const maxRetries = 5;
  for (let i = 0; i < maxRetries; i++) {
    try {
      _db = await Database.load('sqlite:loomflow.db');
      // Quick sanity check
      await _db.select('SELECT 1');
      return _db;
    } catch (err) {
      _db = null;
      if (i < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 300 * (i + 1)));
      } else {
        throw err;
      }
    }
  }
  throw new Error('Failed to connect to database');
}

// ===== Implementation =====

export class SQLiteWorkflowRepository implements WorkflowRepository {
  // ------ Workflow CRUD ------

  async list(): Promise<WorkflowSummary[]> {
    const db = await getDb();
    const rows = await db.select<{
      id: string;
      title: string;
      description: string | null;
      schema_version: number;
      created_at: string;
      updated_at: string;
    }[]>(
      'SELECT id, title, description, schema_version, created_at, updated_at FROM workflows ORDER BY updated_at DESC',
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      schemaVersion: r.schema_version,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async get(id: string): Promise<WorkflowRecord | null> {
    const db = await getDb();
    const rows = await db.select<{
      id: string;
      title: string;
      description: string | null;
      data: string;
      schema_version: number;
      created_at: string;
      updated_at: string;
    }[]>(
      'SELECT id, title, description, data, schema_version, created_at, updated_at FROM workflows WHERE id = $1',
      [id],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      data: parseData(r.data),
      schemaVersion: r.schema_version,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async create(input: CreateWorkflowInput): Promise<WorkflowRecord> {
    const db = await getDb();
    const id = uuid();
    const title = input.title?.trim() || 'Untitled Workflow';
    const description = input.description?.trim() || null;
    const dataJson = JSON.stringify(input.data);
    const ts = nowISO();

    await db.execute(
      `INSERT INTO workflows (id, title, description, data, schema_version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 1, $5, $5)`,
      [id, title, description, dataJson, ts],
    );

    // Record version 1
    await db.execute(
      `INSERT INTO workflow_versions (id, workflow_id, version, title, description, data, created_at)
       VALUES ($1, $2, 1, $3, $4, $5, $6)`,
      [uuid(), id, title, description, dataJson, ts],
    );

    return { id, title, description, data: input.data, schemaVersion: 1, createdAt: ts, updatedAt: ts };
  }

  async update(id: string, input: UpdateWorkflowInput): Promise<WorkflowRecord> {
    const db = await getDb();
    const existing = await this.get(id);
    if (!existing) throw new Error(`Workflow not found: ${id}`);

    const title = input.title?.trim() || existing.title;
    const description = input.description !== undefined ? (input.description?.trim() || null) : existing.description;
    const data = input.data ?? existing.data;
    const dataJson = JSON.stringify(data);
    const ts = nowISO();

    await db.execute(
      `UPDATE workflows SET title = $1, description = $2, data = $3, updated_at = $4 WHERE id = $5`,
      [title, description, dataJson, ts, id],
    );

    // Record new version
    const maxVerRows = await db.select<{ version: number }[]>(
      'SELECT MAX(version) as version FROM workflow_versions WHERE workflow_id = $1',
      [id],
    );
    const nextVersion = (maxVerRows?.[0]?.version ?? 0) + 1;

    await db.execute(
      `INSERT INTO workflow_versions (id, workflow_id, version, title, description, data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uuid(), id, nextVersion, title, description, dataJson, ts],
    );

    return { id, title, description, data, schemaVersion: 1, createdAt: existing.createdAt, updatedAt: ts };
  }

  async delete(id: string): Promise<void> {
    const db = await getDb();
    // CASCADE will handle workflow_versions, executions, execution_logs
    await db.execute('DELETE FROM workflows WHERE id = $1', [id]);
  }

  async duplicate(id: string): Promise<WorkflowRecord> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Workflow not found: ${id}`);
    return this.create({
      title: `${existing.title} (Copy)`,
      description: existing.description ?? undefined,
      data: existing.data,
    });
  }

  // ------ Versions ------

  async listVersions(workflowId: string): Promise<WorkflowVersionRecord[]> {
    const db = await getDb();
    const rows = await db.select<{
      id: string;
      workflow_id: string;
      version: number;
      title: string;
      description: string | null;
      data: string;
      created_at: string;
    }[]>(
      'SELECT id, workflow_id, version, title, description, data, created_at FROM workflow_versions WHERE workflow_id = $1 ORDER BY version DESC',
      [workflowId],
    );
    return rows.map((r) => ({
      id: r.id,
      workflowId: r.workflow_id,
      version: r.version,
      title: r.title,
      description: r.description,
      data: parseData(r.data),
      createdAt: r.created_at,
    }));
  }

  async getVersion(workflowId: string, version: number): Promise<WorkflowVersionRecord | null> {
    const db = await getDb();
    const rows = await db.select<{
      id: string;
      workflow_id: string;
      version: number;
      title: string;
      description: string | null;
      data: string;
      created_at: string;
    }[]>(
      'SELECT id, workflow_id, version, title, description, data, created_at FROM workflow_versions WHERE workflow_id = $1 AND version = $2',
      [workflowId, version],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      workflowId: r.workflow_id,
      version: r.version,
      title: r.title,
      description: r.description,
      data: parseData(r.data),
      createdAt: r.created_at,
    };
  }

  // ------ Executions ------

  async listExecutions(workflowId?: string, limit = 50): Promise<ExecutionRecord[]> {
    const db = await getDb();
    let sql = 'SELECT id, workflow_id, status, input, output, error, started_at, completed_at, duration_ms FROM executions';
    const params: unknown[] = [];
    if (workflowId) {
      sql += ' WHERE workflow_id = $1';
      params.push(workflowId);
    }
    sql += ' ORDER BY started_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);

    const rows = await db.select<{
      id: string;
      workflow_id: string;
      status: string;
      input: string | null;
      output: string | null;
      error: string | null;
      started_at: string;
      completed_at: string | null;
      duration_ms: number | null;
    }[]>(sql, params);

    return rows.map((r) => ({
      id: r.id,
      workflowId: r.workflow_id,
      status: r.status as ExecutionRecord['status'],
      input: r.input ? JSON.parse(r.input) : null,
      output: r.output ? JSON.parse(r.output) : null,
      error: r.error,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      durationMs: r.duration_ms,
    }));
  }

  async getExecution(id: string): Promise<ExecutionRecord | null> {
    const db = await getDb();
    const rows = await db.select<{
      id: string;
      workflow_id: string;
      status: string;
      input: string | null;
      output: string | null;
      error: string | null;
      started_at: string;
      completed_at: string | null;
      duration_ms: number | null;
    }[]>(
      'SELECT id, workflow_id, status, input, output, error, started_at, completed_at, duration_ms FROM executions WHERE id = $1',
      [id],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      workflowId: r.workflow_id,
      status: r.status as ExecutionRecord['status'],
      input: r.input ? JSON.parse(r.input) : null,
      output: r.output ? JSON.parse(r.output) : null,
      error: r.error,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      durationMs: r.duration_ms,
    };
  }

  async createExecution(workflowId: string, input: Record<string, unknown>): Promise<ExecutionRecord> {
    const db = await getDb();
    const id = uuid();
    const ts = nowISO();

    await db.execute(
      `INSERT INTO executions (id, workflow_id, status, input, started_at)
       VALUES ($1, $2, 'running', $3, $4)`,
      [id, workflowId, JSON.stringify(input), ts],
    );

    return {
      id,
      workflowId,
      status: 'running',
      input,
      output: null,
      error: null,
      startedAt: ts,
      completedAt: null,
      durationMs: null,
    };
  }

  async updateExecution(
    id: string,
    updates: Partial<Pick<ExecutionRecord, 'status' | 'output' | 'error' | 'completedAt' | 'durationMs'>>,
  ): Promise<void> {
    const db = await getDb();
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (updates.status !== undefined) {
      sets.push(`status = $${idx++}`);
      params.push(updates.status);
    }
    if (updates.output !== undefined) {
      sets.push(`output = $${idx++}`);
      params.push(JSON.stringify(updates.output));
    }
    if (updates.error !== undefined) {
      sets.push(`error = $${idx++}`);
      params.push(updates.error);
    }
    if (updates.completedAt !== undefined) {
      sets.push(`completed_at = $${idx++}`);
      params.push(updates.completedAt);
    }
    if (updates.durationMs !== undefined) {
      sets.push(`duration_ms = $${idx++}`);
      params.push(updates.durationMs);
    }

    if (sets.length === 0) return;
    params.push(id);
    await db.execute(`UPDATE executions SET ${sets.join(', ')} WHERE id = $${idx}`, params);
  }

  async addExecutionLog(
    executionId: string,
    log: Omit<ExecutionLogRecord, 'id' | 'executionId' | 'createdAt'>,
  ): Promise<void> {
    const db = await getDb();
    await db.execute(
      `INSERT INTO execution_logs (id, execution_id, node_id, level, message, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uuid(), executionId, log.nodeId, log.level, log.message, nowISO()],
    );
  }

  async getExecutionLogs(executionId: string): Promise<ExecutionLogRecord[]> {
    const db = await getDb();
    const rows = await db.select<{
      id: string;
      execution_id: string;
      node_id: string | null;
      level: string;
      message: string;
      created_at: string;
    }[]>(
      'SELECT id, execution_id, node_id, level, message, created_at FROM execution_logs WHERE execution_id = $1 ORDER BY created_at ASC',
      [executionId],
    );
    return rows.map((r) => ({
      id: r.id,
      executionId: r.execution_id,
      nodeId: r.node_id,
      level: r.level as ExecutionLogRecord['level'],
      message: r.message,
      createdAt: r.created_at,
    }));
  }

  // ------ Settings ------

  async getSetting(key: string): Promise<string | null> {
    const db = await getDb();
    const rows = await db.select<{ value: string }[]>(
      'SELECT value FROM settings WHERE key = $1',
      [key],
    );
    return rows.length > 0 ? rows[0].value : null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    const db = await getDb();
    await db.execute(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT(key) DO UPDATE SET value = $2, updated_at = $3`,
      [key, value, nowISO()],
    );
  }

  // ===== Flow Events (SSE 追踪) =====

  async addFlowEvent(
    executionId: string,
    event: Omit<FlowEventRecord, 'id' | 'executionId' | 'createdAt'>,
  ): Promise<void> {
    const db = await getDb();
    await db.execute(
      `INSERT INTO flow_events (id, execution_id, event_type, node_id, node_type, data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        uuid(),
        executionId,
        event.eventType,
        event.nodeId ?? null,
        event.nodeType ?? null,
        event.data ? JSON.stringify(event.data) : null,
        nowISO(),
      ],
    );
  }

  async getFlowEvents(executionId: string): Promise<FlowEventRecord[]> {
    const db = await getDb();
    const rows = await db.select<{
      id: string;
      execution_id: string;
      event_type: string;
      node_id: string | null;
      node_type: string | null;
      data: string | null;
      created_at: string;
    }[]>(
      'SELECT id, execution_id, event_type, node_id, node_type, data, created_at FROM flow_events WHERE execution_id = $1 ORDER BY created_at ASC',
      [executionId],
    );
    return rows.map((r) => ({
      id: r.id,
      executionId: r.execution_id,
      eventType: r.event_type as FlowEventRecord['eventType'],
      nodeId: r.node_id,
      nodeType: r.node_type,
      data: r.data ? JSON.parse(r.data) : null,
      createdAt: r.created_at,
    }));
  }

  // ===== AI Models =====

  async listModels(): Promise<AIModelRecord[]> {
    const db = await getDb();
    const rows = await db.select<{
      id: string;
      provider: string;
      model_name: string;
      display_name: string | null;
      capabilities: string;
      base_url: string | null;
      api_key: string | null;
      is_enabled: number;
      created_at: string;
      updated_at: string;
    }[]>(
      'SELECT id, provider, model_name, display_name, capabilities, base_url, api_key, is_enabled, created_at, updated_at FROM ai_models ORDER BY created_at DESC',
    );
    return rows.map(this.mapAIModel);
  }

  async getEnabledModels(): Promise<AIModelRecord[]> {
    const db = await getDb();
    const rows = await db.select<{
      id: string;
      provider: string;
      model_name: string;
      display_name: string | null;
      capabilities: string;
      base_url: string | null;
      api_key: string | null;
      is_enabled: number;
      created_at: string;
      updated_at: string;
    }[]>(
      'SELECT id, provider, model_name, display_name, capabilities, base_url, api_key, is_enabled, created_at, updated_at FROM ai_models WHERE is_enabled = 1 ORDER BY created_at DESC',
    );
    return rows.map(this.mapAIModel);
  }

  async getModel(id: string): Promise<AIModelRecord | null> {
    const db = await getDb();
    const rows = await db.select<{
      id: string;
      provider: string;
      model_name: string;
      display_name: string | null;
      capabilities: string;
      base_url: string | null;
      api_key: string | null;
      is_enabled: number;
      created_at: string;
      updated_at: string;
    }[]>(
      'SELECT id, provider, model_name, display_name, capabilities, base_url, api_key, is_enabled, created_at, updated_at FROM ai_models WHERE id = $1',
      [id],
    );
    return rows.length > 0 ? this.mapAIModel(rows[0]) : null;
  }

  async createModel(input: CreateAIModelInput): Promise<AIModelRecord> {
    const db = await getDb();
    const id = uuid();
    const ts = nowISO();
    await db.execute(
      `INSERT INTO ai_models (id, provider, model_name, display_name, capabilities, base_url, api_key, is_enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
      [
        id,
        input.provider,
        input.modelName,
        input.displayName ?? null,
        JSON.stringify(input.capabilities ?? ['text']),
        input.baseUrl ?? null,
        input.apiKey ?? null,
        input.isEnabled !== false ? 1 : 0,
        ts,
      ],
    );
    return {
      id,
      provider: input.provider,
      modelName: input.modelName,
      displayName: input.displayName ?? null,
      capabilities: input.capabilities ?? ['text'],
      baseUrl: input.baseUrl ?? null,
      apiKey: input.apiKey ?? null,
      isEnabled: input.isEnabled !== false,
      createdAt: ts,
      updatedAt: ts,
    };
  }

  async updateModel(id: string, input: UpdateAIModelInput): Promise<void> {
    const db = await getDb();
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (input.provider !== undefined) { sets.push(`provider = $${idx++}`); params.push(input.provider); }
    if (input.modelName !== undefined) { sets.push(`model_name = $${idx++}`); params.push(input.modelName); }
    if (input.displayName !== undefined) { sets.push(`display_name = $${idx++}`); params.push(input.displayName); }
    if (input.capabilities !== undefined) { sets.push(`capabilities = $${idx++}`); params.push(JSON.stringify(input.capabilities)); }
    if (input.baseUrl !== undefined) { sets.push(`base_url = $${idx++}`); params.push(input.baseUrl); }
    if (input.apiKey !== undefined) { sets.push(`api_key = $${idx++}`); params.push(input.apiKey); }
    if (input.isEnabled !== undefined) { sets.push(`is_enabled = $${idx++}`); params.push(input.isEnabled ? 1 : 0); }

    if (sets.length === 0) return;
    sets.push(`updated_at = $${idx++}`);
    params.push(nowISO());
    params.push(id);
    await db.execute(`UPDATE ai_models SET ${sets.join(', ')} WHERE id = $${idx}`, params);
  }

  async deleteModel(id: string): Promise<void> {
    const db = await getDb();
    await db.execute('DELETE FROM ai_models WHERE id = $1', [id]);
  }

  private mapAIModel(r: {
    id: string;
    provider: string;
    model_name: string;
    display_name: string | null;
    capabilities: string;
    base_url: string | null;
    api_key: string | null;
    is_enabled: number;
    created_at: string;
    updated_at: string;
  }): AIModelRecord {
    return {
      id: r.id,
      provider: r.provider,
      modelName: r.model_name,
      displayName: r.display_name,
      capabilities: (() => { try { return JSON.parse(r.capabilities); } catch { return ['text']; } })(),
      baseUrl: r.base_url,
      apiKey: r.api_key,
      isEnabled: r.is_enabled === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  // ===== Conversations =====

  async listConversations(): Promise<ConversationSummary[]> {
    const db = await getDb();
    const rows = await db.select<{
      id: string;
      title: string;
      model_id: string | null;
      created_at: string;
      updated_at: string;
    }[]>(
      'SELECT id, title, model_id, created_at, updated_at FROM conversations ORDER BY updated_at DESC',
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      modelId: r.model_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async getConversation(id: string): Promise<ConversationRecord | null> {
    const db = await getDb();
    const rows = await db.select<{
      id: string;
      title: string;
      model_id: string | null;
      created_at: string;
      updated_at: string;
    }[]>(
      'SELECT id, title, model_id, created_at, updated_at FROM conversations WHERE id = $1',
      [id],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      title: r.title,
      modelId: r.model_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async createConversation(title?: string, modelId?: string): Promise<ConversationRecord> {
    const db = await getDb();
    const id = uuid();
    const ts = nowISO();
    await db.execute(
      `INSERT INTO conversations (id, title, model_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)`,
      [id, title ?? 'New Chat', modelId ?? null, ts],
    );
    return { id, title: title ?? 'New Chat', modelId: modelId ?? null, createdAt: ts, updatedAt: ts };
  }

  async updateConversation(id: string, input: { title?: string; modelId?: string }): Promise<void> {
    const db = await getDb();
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    if (input.title !== undefined) { sets.push(`title = $${idx++}`); params.push(input.title); }
    if (input.modelId !== undefined) { sets.push(`model_id = $${idx++}`); params.push(input.modelId); }
    if (sets.length === 0) return;
    sets.push(`updated_at = $${idx++}`);
    params.push(nowISO());
    params.push(id);
    await db.execute(`UPDATE conversations SET ${sets.join(', ')} WHERE id = $${idx}`, params);
  }

  async deleteConversation(id: string): Promise<void> {
    const db = await getDb();
    await db.execute('DELETE FROM conversations WHERE id = $1', [id]);
  }

  // ===== Messages =====

  async listMessages(conversationId: string): Promise<MessageRecord[]> {
    const db = await getDb();
    const rows = await db.select<{
      id: string;
      conversation_id: string;
      role: string;
      content: string;
      model_id: string | null;
      metadata: string | null;
      created_at: string;
    }[]>(
      'SELECT id, conversation_id, role, content, model_id, metadata, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [conversationId],
    );
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      role: r.role as MessageRecord['role'],
      content: r.content,
      modelId: r.model_id,
      metadata: r.metadata ? (() => { try { return JSON.parse(r.metadata); } catch { return null; } })() : null,
      createdAt: r.created_at,
    }));
  }

  async createMessage(
    conversationId: string,
    role: MessageRecord['role'],
    content: string,
    metadata?: Record<string, unknown>,
    modelId?: string,
  ): Promise<MessageRecord> {
    const db = await getDb();
    const id = uuid();
    const ts = nowISO();
    await db.execute(
      `INSERT INTO messages (id, conversation_id, role, content, model_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, conversationId, role, content, modelId ?? null, metadata ? JSON.stringify(metadata) : null, ts],
    );
    // Update conversation's updated_at
    await db.execute('UPDATE conversations SET updated_at = $1 WHERE id = $2', [ts, conversationId]);
    return { id, conversationId, role, content, modelId: modelId ?? null, metadata: metadata ?? null, createdAt: ts };
  }

  async deleteMessage(id: string): Promise<void> {
    const db = await getDb();
    await db.execute('DELETE FROM messages WHERE id = $1', [id]);
  }
}
