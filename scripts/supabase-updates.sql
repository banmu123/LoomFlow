-- =====================================================
-- LoomFlow 增量更新 SQL（在 supabase-init.sql + supabase-users.sql 之后执行）
-- 全部幂等（IF NOT EXISTS），可重复执行
-- 覆盖：数据隔离 / 配额 / 去重 / 审计 / API 日志 / 执行历史 / 模型配置 / 定时任务
-- =====================================================

-- 1. 工作流去重：data_hash 列（唯一索引在 user_id 列添加后创建，见第 3 节）
ALTER TABLE workflow_history ADD COLUMN IF NOT EXISTS data_hash TEXT;
DROP INDEX IF EXISTS idx_workflow_history_data_hash;  -- 移除旧的全局限索引

-- 2. 用户配额与状态
ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_quota INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
-- admin 默认大配额（-1 表示不限，如已设置则跳过）
UPDATE users SET chat_quota = 99999 WHERE username = 'admin' AND chat_quota = 0;

-- 3. 数据隔离：user_id 列（含存量数据归属 admin）
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE workflow_history ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

UPDATE conversations SET user_id = (SELECT id FROM users WHERE username = 'admin') WHERE user_id IS NULL;
UPDATE messages SET user_id = (SELECT id FROM users WHERE username = 'admin') WHERE user_id IS NULL;
UPDATE workflow_history SET user_id = (SELECT id FROM users WHERE username = 'admin') WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_workflow_history_user ON workflow_history(user_id);
-- 每用户去重唯一索引（依赖上面的 user_id 列）
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_history_user_hash ON workflow_history(user_id, data_hash);

-- 4. 工作流：发布 / 分享 / API 配额
ALTER TABLE workflow_history ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE workflow_history ADD COLUMN IF NOT EXISTS api_key TEXT;
ALTER TABLE workflow_history ADD COLUMN IF NOT EXISTS api_quota INTEGER NOT NULL DEFAULT -1;
ALTER TABLE workflow_history ADD COLUMN IF NOT EXISTS api_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workflow_history ADD COLUMN IF NOT EXISTS share_token TEXT;
ALTER TABLE workflow_history ADD COLUMN IF NOT EXISTS description TEXT;
CREATE INDEX IF NOT EXISTS idx_workflow_history_share ON workflow_history(share_token);

-- 5. 消息：图片附件
ALTER TABLE messages ADD COLUMN IF NOT EXISTS images JSONB;

-- 6. 审计日志表
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  username TEXT,
  action TEXT NOT NULL,
  detail JSONB,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- 7. API 调用日志表
CREATE TABLE IF NOT EXISTS api_call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflow_history(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  inputs JSONB,
  outputs JSONB,
  error TEXT,
  duration_ms INTEGER,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_call_logs_workflow ON api_call_logs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_api_call_logs_created ON api_call_logs(created_at DESC);

-- 8. 执行记录表
CREATE TABLE IF NOT EXISTS flow_runs (
  id UUID PRIMARY KEY,
  workflow_id UUID REFERENCES workflow_history(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'internal',
  status TEXT NOT NULL,
  inputs JSONB,
  outputs JSONB,
  events JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_flow_runs_user ON flow_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_flow_runs_created ON flow_runs(created_at DESC);

-- 9. 定时任务表
CREATE TABLE IF NOT EXISTS scheduled_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflow_history(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  cron_expr TEXT NOT NULL,
  inputs JSONB DEFAULT '{}',
  webhook_url TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scheduled_runs_workflow ON scheduled_runs(workflow_id);

-- 10. 模型配置表（初始为空，由用户在管理后台 → 模型配置添加）
CREATE TABLE IF NOT EXISTS ai_models (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  capabilities JSONB NOT NULL DEFAULT '["text"]',
  label TEXT,
  base_url TEXT,
  api_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 11. RLS（与现有表一致，宽松策略）
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_call_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_models ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_policies WHERE policyname = 'Allow all on audit_logs' AND tablename = 'audit_logs') THEN
    CREATE POLICY "Allow all on audit_logs" ON audit_logs FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_policies WHERE policyname = 'Allow all on api_call_logs' AND tablename = 'api_call_logs') THEN
    CREATE POLICY "Allow all on api_call_logs" ON api_call_logs FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_policies WHERE policyname = 'Allow all on flow_runs' AND tablename = 'flow_runs') THEN
    CREATE POLICY "Allow all on flow_runs" ON flow_runs FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_policies WHERE policyname = 'Allow all on scheduled_runs' AND tablename = 'scheduled_runs') THEN
    CREATE POLICY "Allow all on scheduled_runs" ON scheduled_runs FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_policies WHERE policyname = 'Allow all on ai_models' AND tablename = 'ai_models') THEN
    CREATE POLICY "Allow all on ai_models" ON ai_models FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 24. 后台生成：消息工具执行日志（后台执行器流式写入，前端轮询展示）
ALTER TABLE messages ADD COLUMN IF NOT EXISTS tool_logs JSONB;


-- 26. 自定义节点库（Phase 5）：用户创建的节点定义，持久化后合并进 NodeRegistry
CREATE TABLE IF NOT EXISTS node_definitions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type          TEXT NOT NULL,                     -- 节点类型标识（如 myNode，用户唯一即可）
  label         TEXT NOT NULL,
  description   TEXT,
  category      TEXT NOT NULL DEFAULT 'custom',
  icon          TEXT,
  inputs        JSONB NOT NULL DEFAULT '[]',       -- NodePortDefinition[]
  outputs       JSONB NOT NULL DEFAULT '[]',
  config_schema JSONB NOT NULL DEFAULT '[]',       -- NodeConfigField[]
  capabilities  JSONB NOT NULL DEFAULT '["text"]',
  version       INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'active',    -- active | disabled
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (type, user_id)
);
CREATE INDEX IF NOT EXISTS idx_node_definitions_user ON node_definitions(user_id);

-- 25. 迁移完成后刷新 PostgREST schema 缓存（否则新列 PATCH 报 PGRST204）
NOTIFY pgrst, 'reload schema';
