-- =====================================================
-- LoomFlow v0.2 迁移：工作流版本历史
-- 每次保存都记录一份快照；修改保存只更新原记录，不新增列表条目
-- 执行方式：Supabase → SQL Editor → 粘贴运行（可重复执行）
-- =====================================================

-- 1. 版本历史表（每个工作流的每次保存 = 一条版本快照）
CREATE TABLE IF NOT EXISTS workflow_versions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflow_history(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,                    -- 从 1 递增
  title       TEXT NOT NULL DEFAULT '未命名工作流',
  description TEXT,
  data        JSONB NOT NULL,                      -- 完整工作流快照 { nodes, edges, viewport }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, version)
);

CREATE INDEX IF NOT EXISTS idx_workflow_versions_workflow
  ON workflow_versions (workflow_id, version DESC);

-- 2. RLS（与现有表一致：开发期允许全部访问，应用侧使用 service_role）
ALTER TABLE workflow_versions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_policies WHERE policyname = 'Allow all on workflow_versions' AND tablename = 'workflow_versions') THEN
    CREATE POLICY "Allow all on workflow_versions" ON workflow_versions FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 3. 存量迁移：给现有已保存的工作流补一条版本快照（version 1，便于历史面板显示）
--    ⚠️ INSERT..SELECT 中源表列与目标表同名须用别名限定（PostgreSQL 会解析到目标表）
INSERT INTO workflow_versions (workflow_id, version, title, description, data, created_at)
SELECT wh.id, 1, wh.title, wh.description, wh.data, wh.updated_at
FROM workflow_history wh
WHERE wh.saved = true
ON CONFLICT (workflow_id, version) DO NOTHING;
