-- Migration 002: Executions and Logs
-- LoomFlow Desktop — SQLite schema

CREATE TABLE IF NOT EXISTS executions (
    id           TEXT PRIMARY KEY NOT NULL,
    workflow_id  TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'pending',  -- pending | running | completed | failed | cancelled | timeout
    input        TEXT,   -- JSON: input parameters
    output       TEXT,   -- JSON: execution output
    error        TEXT,
    started_at   TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    duration_ms  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_executions_workflow_id ON executions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_executions_started_at ON executions(started_at DESC);

CREATE TABLE IF NOT EXISTS execution_logs (
    id           TEXT PRIMARY KEY NOT NULL,
    execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
    node_id      TEXT,
    level        TEXT NOT NULL DEFAULT 'info',  -- debug | info | warn | error
    message      TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_execution_logs_execution_id ON execution_logs(execution_id);
