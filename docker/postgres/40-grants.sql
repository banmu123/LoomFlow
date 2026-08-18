-- LoomFlow 自托管：PostgREST 角色授权（在表创建之后执行）
-- Supabase 云自动处理，自托管需显式 GRANT
--
-- ⚠️ 重要：本文件只在数据卷【首次初始化】时执行。
-- 之后 migration 阶段新建的表由 scripts/supabase-updates.sql 每轮补授权，
-- 此处通过 ALTER DEFAULT PRIVILEGES 保证【未来任何 postgres 角色创建的表/序列/函数
-- 自动携带 anon/service_role 授权】——双保险，杜绝"新表无权限"问题。

GRANT USAGE ON SCHEMA public TO anon, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, service_role;

-- 默认权限：此后 postgres 角色新建的对象自动授权（治本）
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, service_role;
