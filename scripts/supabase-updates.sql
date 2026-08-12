-- =====================================================
-- ForgeFlow 增量更新 SQL（在 supabase-init.sql + supabase-users.sql 之后执行）
-- 全部幂等（IF NOT EXISTS），可重复执行
-- =====================================================

-- 1. 工作流去重：data_hash 列 + 每用户唯一索引
ALTER TABLE workflow_history ADD COLUMN IF NOT EXISTS data_hash TEXT;
DROP INDEX IF EXISTS idx_workflow_history_data_hash;  -- 移除旧的全局限索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_history_user_hash ON workflow_history(user_id, data_hash);

-- 2. 用户配额与状态
ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_quota INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
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

-- 4. 工作流发布（外部 API 调用）
ALTER TABLE workflow_history ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE workflow_history ADD COLUMN IF NOT EXISTS api_key TEXT;
