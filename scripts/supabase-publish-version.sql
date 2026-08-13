-- =====================================================
-- LoomFlow v0.2 迁移：发布指定版本
-- workflow_history 增加 published_version：记录发布时选择的版本号
-- 执行方式：Supabase → SQL Editor → 粘贴运行（可重复执行）
-- =====================================================

-- 发布时指定的版本号（NULL = 未发布 / 发布当前内容时未指定版本）
ALTER TABLE workflow_history ADD COLUMN IF NOT EXISTS published_version INTEGER;

-- 发布内容的快照（发布时从版本/当前内容复制，外部 API 执行这份数据；
-- 后续保存不覆盖，保证发布版本不受编辑影响）
ALTER TABLE workflow_history ADD COLUMN IF NOT EXISTS published_data JSONB;
