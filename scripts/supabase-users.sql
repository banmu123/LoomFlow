-- =====================================================
-- ForgeFlow 用户表 + 初始 admin 账号
-- 请在 Supabase SQL Editor 中执行此文件
-- =====================================================

-- 0. 确保 pgcrypto 扩展可用（crypt/gen_salt 依赖）
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. 用户表
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username        TEXT NOT NULL UNIQUE,              -- 登录用户名
  password_hash   TEXT NOT NULL,                     -- bcrypt 哈希
  display_name    TEXT,                              -- 显示名称
  avatar_url      TEXT,                              -- 头像
  role            TEXT NOT NULL DEFAULT 'user',      -- user / admin
  feishu_union_id TEXT UNIQUE,                       -- 飞书用户标识（后续接入）
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. updated_at 自动更新触发器（若已创建则跳过）
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3. 开启 RLS（开发阶段宽松策略，与现有表保持一致）
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on users"
  ON users FOR ALL
  USING (true)
  WITH CHECK (true);

-- 4. 创建 admin 用户（⚠️ 请先修改为你的强密码，然后执行）
--    使用 pgcrypto 的 crypt/gen_salt（Supabase 已内置启用）
INSERT INTO users (username, password_hash, display_name, role)
VALUES ('admin', crypt('CHANGE_ME_STRONG_PASSWORD', gen_salt('bf', 10)), '管理员', 'admin')
ON CONFLICT (username) DO NOTHING;
