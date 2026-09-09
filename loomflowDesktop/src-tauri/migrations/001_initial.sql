-- Migration 001: Workflows and Versions
-- LoomFlow Desktop — SQLite schema

CREATE TABLE IF NOT EXISTS workflows (
    id          TEXT PRIMARY KEY NOT NULL,
    title       TEXT NOT NULL DEFAULT 'Untitled Workflow',
    description TEXT,
    data        TEXT NOT NULL,  -- JSON: TinyflowData { nodes, edges, viewport }
    schema_version INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workflows_updated_at ON workflows(updated_at DESC);

CREATE TABLE IF NOT EXISTS workflow_versions (
    id          TEXT PRIMARY KEY NOT NULL,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    version     INTEGER NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    description TEXT,
    data        TEXT NOT NULL,  -- JSON: TinyflowData snapshot
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(workflow_id, version)
);

CREATE INDEX IF NOT EXISTS idx_workflow_versions_workflow_id ON workflow_versions(workflow_id);
