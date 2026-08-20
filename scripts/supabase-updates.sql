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

-- 27. 搜索服务配置表（初始为空，由用户在管理后台 → 搜索配置添加）
CREATE TABLE IF NOT EXISTS search_providers (
  id            TEXT PRIMARY KEY,               -- 配置名（用户可读，如 tavily-main）
  provider      TEXT NOT NULL,                  -- tavily / exa / google
  label         TEXT,
  api_key       TEXT,
  base_url      TEXT,                           -- 自定义端点（留空用默认）
  config        JSONB NOT NULL DEFAULT '{}',    -- provider 专属配置（如 google 的 cx）
  capabilities  JSONB NOT NULL DEFAULT '["web"]',
  enabled       BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE search_providers ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_policies WHERE policyname = 'Allow all on search_providers' AND tablename = 'search_providers') THEN
    CREATE POLICY "Allow all on search_providers" ON search_providers FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 28. 迁移完成后刷新 PostgREST schema 缓存（否则新列 PATCH 报 PGRST204）
NOTIFY pgrst, 'reload schema';

-- 29. 自定义节点：复用内置执行器（executor_type 落库，重启后恢复绑定）
-- 空/等于自身 type = 未绑定（执行报「未注册执行器」）；指定内置节点 type（如 templateNode）= 复用其执行逻辑
ALTER TABLE node_definitions ADD COLUMN IF NOT EXISTS executor_type TEXT;

-- 30. 增量建表权限（40-grants.sql 仅在数据卷首次初始化时执行，之后 migration 阶段新建的表
-- 如 node_definitions / search_providers 需在此补授权；每次 compose up 重跑，未来新表也覆盖）
GRANT USAGE ON SCHEMA public TO anon, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, service_role;

-- 30.5 默认权限（治本）：migration 以 postgres 角色建表，此后新建对象自动带授权，
-- 即使未来新增独立 SQL 文件漏写 GRANT 也不会复现"新表无权限"问题
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, service_role;

-- 31. 迁移完成后刷新 PostgREST schema 缓存
NOTIFY pgrst, 'reload schema';

-- 32. 全局 API Key 加密：加哈希列（等值鉴权用），api_key 列改存密文
-- 存量明文 key 回填哈希（密文由应用下次轮换时写入，decrypt 兼容明文）
CREATE EXTENSION IF NOT EXISTS pgcrypto;
ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS api_key_hash TEXT;
UPDATE user_api_keys
   SET api_key_hash = encode(digest(api_key, 'sha256'), 'hex')
 WHERE api_key_hash IS NULL AND api_key IS NOT NULL;

-- 33. 迁移完成后刷新 PostgREST schema 缓存
NOTIFY pgrst, 'reload schema';

-- 34. 执行记录保存画布数据快照（历史回看节点级 trace 时映射 nodeId → 节点名/类型）
ALTER TABLE flow_runs ADD COLUMN IF NOT EXISTS flow_data JSONB;

-- 35. Brew Notes：工作流设计笔记（决策/问题/方案/优化/用途）
-- Note 属于 Workflow（user 隔离），version 可选绑定（不破坏版本系统）
CREATE TABLE IF NOT EXISTS workflow_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflow_history(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version     INTEGER,                          -- 可选：绑定的工作流版本（v{version}）
  type        TEXT NOT NULL DEFAULT 'general', -- general/decision/problem/solution/optimization/usage
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workflow_notes_workflow ON workflow_notes(workflow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_notes_user ON workflow_notes(user_id);
ALTER TABLE workflow_notes ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_policies WHERE policyname = 'Allow all on workflow_notes' AND tablename = 'workflow_notes') THEN
    CREATE POLICY "Allow all on workflow_notes" ON workflow_notes FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 36. 迁移完成后刷新 PostgREST schema 缓存
NOTIFY pgrst, 'reload schema';

-- 37. Growth System：成长目标（Goal）
CREATE TABLE IF NOT EXISTS goals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'active',  -- active / paused / done
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_goals_user ON goals(user_id);

-- 38. Growth System：学习路径（Journey，属于 Goal）
CREATE TABLE IF NOT EXISTS journeys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id     UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'active',  -- active / archived
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_journeys_goal ON journeys(goal_id);
CREATE INDEX IF NOT EXISTS idx_journeys_user ON journeys(user_id);

-- 39. Growth System：路径阶段（Journey Capability）
CREATE TABLE IF NOT EXISTS journey_capabilities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id    UUID NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  "order"       INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'locked', -- locked / exploring / developing / mastered
  prerequisites JSONB NOT NULL DEFAULT '[]',    -- 前置能力（title 列表）
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_capabilities_journey ON journey_capabilities(journey_id, "order");
CREATE INDEX IF NOT EXISTS idx_capabilities_user ON journey_capabilities(user_id);

-- 40. Growth 表 RLS + 权限（GRANT 由第 30 节每轮执行覆盖）
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_capabilities ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_policies WHERE policyname = 'Allow all on goals' AND tablename = 'goals') THEN
    CREATE POLICY "Allow all on goals" ON goals FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT FROM pg_policies WHERE policyname = 'Allow all on journeys' AND tablename = 'journeys') THEN
    CREATE POLICY "Allow all on journeys" ON journeys FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT FROM pg_policies WHERE policyname = 'Allow all on journey_capabilities' AND tablename = 'journey_capabilities') THEN
    CREATE POLICY "Allow all on journey_capabilities" ON journey_capabilities FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 41. 迁移完成后刷新 PostgREST schema 缓存
NOTIFY pgrst, 'reload schema';

-- 42. Growth System：里程碑（真实行为首次达成，唯一一次，非 XP）
CREATE TABLE IF NOT EXISTS milestones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,   -- first_brew / first_recipe / ai_creator / workflow_builder / debugger / automator
  achieved_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ref_workflow_id UUID REFERENCES workflow_history(id) ON DELETE SET NULL,  -- 可关联工作流
  ref_evidence    TEXT,            -- 触发证据摘要
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, type)           -- 只能达成一次
);
CREATE INDEX IF NOT EXISTS idx_milestones_user ON milestones(user_id);
ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_policies WHERE policyname = 'Allow all on milestones' AND tablename = 'milestones') THEN
    CREATE POLICY "Allow all on milestones" ON milestones FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 43. 迁移完成后刷新 PostgREST schema 缓存
NOTIFY pgrst, 'reload schema';
