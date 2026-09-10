/**
 * Workflow Repository Tests
 *
 * 测试 SQLiteWorkflowRepository 的核心逻辑。
 * 通过 mock @tauri-apps/plugin-sql 来模拟数据库操作。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ===== Mock @tauri-apps/plugin-sql =====

// In-memory store for mock DB
let mockDb: Map<string, unknown[]> = new Map();
const mockExecuteResults: unknown[] = [];
let mockSelectResults: unknown[][] = [];

const mockDbInstance = {
  select: vi.fn(async (sql: string, _params?: unknown[]) => {
    // Return the next pre-set result
    return mockSelectResults.shift() ?? [];
  }),
  execute: vi.fn(async (sql: string, _params?: unknown[]) => {
    return { rowsAffected: 1, lastInsertId: 1 };
  }),
};

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: vi.fn(async () => mockDbInstance),
  },
}));

// Reset mock state before each test
beforeEach(() => {
  vi.clearAllMocks();
  mockSelectResults = [];
  mockDb = new Map();
  // Reset the cached DB singleton by setting it to null via dynamic import trick
  // Since _db is module-level, we need to reset it through the mock
  mockDbInstance.select.mockImplementation(async () => mockSelectResults.shift() ?? []);
});

// ===== Import after mock setup =====
// We need to reset the module between tests to reset the singleton DB connection

describe('SQLiteWorkflowRepository', () => {
  it('should implement WorkflowRepository interface', async () => {
    // Dynamically import to pick up mocks
    const { SQLiteWorkflowRepository } = await import(
      '../app/repositories/sqlite-workflow-repository'
    );
    const repo = new SQLiteWorkflowRepository();

    // Verify all required methods exist
    expect(typeof repo.list).toBe('function');
    expect(typeof repo.get).toBe('function');
    expect(typeof repo.create).toBe('function');
    expect(typeof repo.update).toBe('function');
    expect(typeof repo.delete).toBe('function');
    expect(typeof repo.duplicate).toBe('function');
    expect(typeof repo.listVersions).toBe('function');
    expect(typeof repo.getVersion).toBe('function');
    expect(typeof repo.listExecutions).toBe('function');
    expect(typeof repo.getExecution).toBe('function');
    expect(typeof repo.createExecution).toBe('function');
    expect(typeof repo.updateExecution).toBe('function');
    expect(typeof repo.addExecutionLog).toBe('function');
    expect(typeof repo.getExecutionLogs).toBe('function');
    expect(typeof repo.getSetting).toBe('function');
    expect(typeof repo.setSetting).toBe('function');
  });

  it('list() should return workflow summaries', async () => {
    const { SQLiteWorkflowRepository } = await import(
      '../app/repositories/sqlite-workflow-repository'
    );
    const repo = new SQLiteWorkflowRepository();

    // First result is consumed by getDb() SELECT 1 sanity check
    mockSelectResults = [
      [], // SELECT 1 from getDb()
      [
        {
          id: 'wf-1',
          title: 'Test Workflow',
          description: 'A test',
          schema_version: 1,
          created_at: '2024-01-01 00:00:00',
          updated_at: '2024-01-02 00:00:00',
        },
      ],
    ];

    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('wf-1');
    expect(list[0].title).toBe('Test Workflow');
    expect(list[0].schemaVersion).toBe(1);
  });

  it('get() should return null for non-existent workflow', async () => {
    const { SQLiteWorkflowRepository } = await import(
      '../app/repositories/sqlite-workflow-repository'
    );
    const repo = new SQLiteWorkflowRepository();

    mockSelectResults = [[]]; // Empty result

    const result = await repo.get('non-existent');
    expect(result).toBeNull();
  });

  it('create() should insert workflow and version', async () => {
    const { SQLiteWorkflowRepository } = await import(
      '../app/repositories/sqlite-workflow-repository'
    );
    const repo = new SQLiteWorkflowRepository();

    const data = {
      nodes: [
        { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: { title: 'Start', description: '', condition: '', loopEnable: false, loopIntervalMs: '', maxLoopCount: '', loopBreakCondition: '', retryEnable: false, retryIntervalMs: '', maxRetryCount: '', resetRetryCountAfterNormal: false } },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const result = await repo.create({ title: 'My Workflow', data });

    expect(result.title).toBe('My Workflow');
    expect(result.data).toEqual(data);
    expect(result.schemaVersion).toBe(1);
    expect(result.id).toBeTruthy();

    // Should have called execute twice (insert workflow + insert version)
    expect(mockDbInstance.execute).toHaveBeenCalledTimes(2);
  });

  it('delete() should execute DELETE query', async () => {
    const { SQLiteWorkflowRepository } = await import(
      '../app/repositories/sqlite-workflow-repository'
    );
    const repo = new SQLiteWorkflowRepository();

    await repo.delete('wf-1');

    expect(mockDbInstance.execute).toHaveBeenCalledWith(
      'DELETE FROM workflows WHERE id = $1',
      ['wf-1'],
    );
  });

  it('getSetting() should return null for non-existent key', async () => {
    const { SQLiteWorkflowRepository } = await import(
      '../app/repositories/sqlite-workflow-repository'
    );
    const repo = new SQLiteWorkflowRepository();

    mockSelectResults = [[]];

    const result = await repo.getSetting('nonexistent');
    expect(result).toBeNull();
  });

  it('setSetting() should upsert setting', async () => {
    const { SQLiteWorkflowRepository } = await import(
      '../app/repositories/sqlite-workflow-repository'
    );
    const repo = new SQLiteWorkflowRepository();

    await repo.setSetting('theme', 'dark');

    expect(mockDbInstance.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO settings'),
      expect.arrayContaining(['theme', 'dark']),
    );
  });

  it('listExecutions() should return execution records', async () => {
    const { SQLiteWorkflowRepository } = await import(
      '../app/repositories/sqlite-workflow-repository'
    );
    const repo = new SQLiteWorkflowRepository();

    mockSelectResults = [
      [
        {
          id: 'exec-1',
          workflow_id: 'wf-1',
          status: 'completed',
          input: '{"query":"test"}',
          output: '{"result":"ok"}',
          error: null,
          started_at: '2024-01-01 00:00:00',
          completed_at: '2024-01-01 00:00:05',
          duration_ms: 5000,
        },
      ],
    ];

    const execs = await repo.listExecutions('wf-1');
    expect(execs).toHaveLength(1);
    expect(execs[0].id).toBe('exec-1');
    expect(execs[0].status).toBe('completed');
    expect(execs[0].input).toEqual({ query: 'test' });
    expect(execs[0].output).toEqual({ result: 'ok' });
    expect(execs[0].durationMs).toBe(5000);
  });

  it('createExecution() should insert running execution', async () => {
    const { SQLiteWorkflowRepository } = await import(
      '../app/repositories/sqlite-workflow-repository'
    );
    const repo = new SQLiteWorkflowRepository();

    const result = await repo.createExecution('wf-1', { query: 'hello' });

    expect(result.workflowId).toBe('wf-1');
    expect(result.status).toBe('running');
    expect(result.input).toEqual({ query: 'hello' });
    expect(result.id).toBeTruthy();
  });

  it('addExecutionLog() should insert log entry', async () => {
    const { SQLiteWorkflowRepository } = await import(
      '../app/repositories/sqlite-workflow-repository'
    );
    const repo = new SQLiteWorkflowRepository();

    await repo.addExecutionLog('exec-1', {
      nodeId: 'node-1',
      level: 'info',
      message: 'Node completed',
    });

    expect(mockDbInstance.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO execution_logs'),
      expect.arrayContaining(['exec-1', 'node-1', 'info', 'Node completed']),
    );
  });
});
