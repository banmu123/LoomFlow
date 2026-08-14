-- =====================================================
-- LoomFlow v0.2 迁移：应用设置（动态配置，无需改环境变量）
-- 如：OSS 存储配置（管理后台「存储设置」页写入）
-- 执行方式：Supabase → SQL Editor → 粘贴运行（可重复执行）
-- =====================================================

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_policies WHERE policyname = 'Allow all on app_settings' AND tablename = 'app_settings') THEN
    CREATE POLICY "Allow all on app_settings" ON app_settings FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
