-- =====================================================
-- LoomFlow v0.2 迁移：全局 API Key
-- 一个用户一个 API Key，可调用该用户所有已发布工作流
-- 无调用次数限制，只管理 Key 的有效期
-- 执行方式：Supabase → SQL Editor → 粘贴运行（可重复执行）
-- =====================================================

-- 1. 全局 API Key 表（每个用户一行）
CREATE TABLE IF NOT EXISTS user_api_keys (
  user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  api_key              TEXT NOT NULL UNIQUE,             -- ffk_xxx
  api_key_expires_days INTEGER,                          -- 配置的有效期天数（0/空 = 永不过期）
  api_key_expires_at   TIMESTAMPTZ,                      -- 计算出的过期时间
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_api_keys_api_key ON user_api_keys(api_key);

-- 2. 兼容早期版本（曾包含配额列）：删除不再使用的列
ALTER TABLE user_api_keys DROP COLUMN IF EXISTS api_quota;
ALTER TABLE user_api_keys DROP COLUMN IF EXISTS api_used;

-- 3. RLS（与现有表一致：开发期允许全部访问，应用侧使用 service_role）
ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_policies WHERE policyname = 'Allow all on user_api_keys' AND tablename = 'user_api_keys') THEN
    CREATE POLICY "Allow all on user_api_keys" ON user_api_keys FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 4. 存量迁移：把每个用户第一个（最近更新）已发布工作流的 Key 提升为全局 Key
--    这样已有 API Key 的调用方无需更换 Key 即可继续使用
--    ⚠️ INSERT..SELECT 中源表列名与目标表同名时须用别名限定，否则 PostgreSQL 会解析到目标表
--    部分环境的 workflow_history 没有 api_key_expires_at 列，动态判断列存在性以兼容两种 schema
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workflow_history' AND column_name = 'api_key_expires_at'
  ) THEN
    EXECUTE '
      INSERT INTO user_api_keys (user_id, api_key, api_key_expires_at)
      SELECT DISTINCT ON (wh.user_id) wh.user_id, wh.api_key, wh.api_key_expires_at
      FROM workflow_history wh
      WHERE wh.published = true AND wh.api_key IS NOT NULL
      ORDER BY wh.user_id, wh.updated_at DESC
      ON CONFLICT (user_id) DO NOTHING';
  ELSE
    EXECUTE '
      INSERT INTO user_api_keys (user_id, api_key)
      SELECT DISTINCT ON (wh.user_id) wh.user_id, wh.api_key
      FROM workflow_history wh
      WHERE wh.published = true AND wh.api_key IS NOT NULL
      ORDER BY wh.user_id, wh.updated_at DESC
      ON CONFLICT (user_id) DO NOTHING';
  END IF;
END $$;
