-- LoomFlow 自托管数据库初始化（PostgreSQL 容器首次启动自动执行）
-- 创建扩展与 PostgREST 所需角色

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- PostgREST 需要的角色（匿名 + service_role）
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;
