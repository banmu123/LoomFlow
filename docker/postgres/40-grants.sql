-- LoomFlow 自托管：PostgREST 角色授权（在表创建之后执行）
-- Supabase 云自动处理，自托管需显式 GRANT

GRANT USAGE ON SCHEMA public TO anon, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, service_role;
