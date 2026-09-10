-- P2: 对话和消息表
-- 存储 AI 对话历史

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New Chat',
  model_id TEXT,                   -- 使用的模型 ID
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,              -- user / assistant / system
  content TEXT NOT NULL DEFAULT '',
  model_id TEXT,                   -- 生成此消息的模型
  metadata TEXT,                   -- JSON: { reasoning, toolCalls, tokens, ... }
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
