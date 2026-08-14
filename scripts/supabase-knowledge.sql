-- =====================================================
-- LoomFlow v0.2 迁移：知识库
-- 每用户独立知识库；storage_type 决定文档原文存储位置
--   database：原文存数据库（默认，零配置）
--   oss：原文存 OSS，数据库只存检索文本
-- 执行方式：Supabase → SQL Editor → 粘贴运行（可重复执行）
-- =====================================================

-- 1. 知识库
CREATE TABLE IF NOT EXISTS knowledge_bases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  storage_type TEXT NOT NULL DEFAULT 'database',   -- database | oss
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_bases_user ON knowledge_bases(user_id);

-- 2. 知识库文档（content 始终存数据库，用于检索；oss 模式原文另存 OSS）
CREATE TABLE IF NOT EXISTS knowledge_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  content           TEXT NOT NULL,                 -- 检索文本（两种存储模式都有）
  oss_key           TEXT,                          -- oss 模式：原文在 OSS 的 key
  file_type         TEXT,                          -- txt / md / paste
  file_size         INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_kb ON knowledge_documents(knowledge_base_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_kb_created
  ON knowledge_documents(knowledge_base_id, created_at DESC);

-- 3. RLS（与现有表一致：应用侧使用 service_role）
ALTER TABLE knowledge_bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_policies WHERE policyname = 'Allow all on knowledge_bases' AND tablename = 'knowledge_bases') THEN
    CREATE POLICY "Allow all on knowledge_bases" ON knowledge_bases FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_policies WHERE policyname = 'Allow all on knowledge_documents' AND tablename = 'knowledge_documents') THEN
    CREATE POLICY "Allow all on knowledge_documents" ON knowledge_documents FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
