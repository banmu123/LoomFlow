-- P1: AI 模型配置表
-- 存储用户配置的 LLM 模型，支持多个 provider

CREATE TABLE IF NOT EXISTS ai_models (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,          -- deepseek / openai / claude / gemini / qwen / ark / ollama / custom
  model_name TEXT NOT NULL,        -- e.g. deepseek-chat, gpt-4o
  display_name TEXT,               -- 用户自定义显示名
  capabilities TEXT DEFAULT '["text"]',  -- JSON array: text / vision / tool
  base_url TEXT,                   -- API base URL，为空时用 provider 默认值
  api_key TEXT,                    -- API key（桌面端存 SQLite，后续迁移 Keychain）
  is_enabled INTEGER DEFAULT 1,    -- 0=禁用 1=启用
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 默认添加 DeepSeek 模型（最常用的免费/低价国产模型）
INSERT OR IGNORE INTO ai_models (id, provider, model_name, display_name, capabilities, base_url, is_enabled, created_at, updated_at)
VALUES (
  'default-deepseek',
  'deepseek',
  'deepseek-chat',
  'DeepSeek Chat',
  '["text","tool"]',
  'https://api.deepseek.com',
  0,  -- 默认禁用，需要用户填入 API key
  datetime('now'),
  datetime('now')
);
