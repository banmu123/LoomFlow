-- P3: 流执行事件表
-- 记录节点级执行事件，支持 SSE 实时追踪

CREATE TABLE IF NOT EXISTS flow_events (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,        -- flow_start / node_start / node_complete / node_error / flow_complete / flow_error
  node_id TEXT,
  node_type TEXT,
  data TEXT,                       -- JSON payload: { input, output, durationMs, error, ... }
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_flow_events_execution ON flow_events(execution_id, created_at);
