-- =====================================================
-- ForgeFlow Supabase 初始化 SQL
-- 请在 Supabase SQL Editor 中执行此文件
-- =====================================================

-- 1. 对话会话表
CREATE TABLE IF NOT EXISTS conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL DEFAULT '新建对话',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. 对话消息表
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL DEFAULT '',
  reasoning       TEXT,                  -- 思考过程
  status          TEXT DEFAULT 'done',   -- pending | streaming | done | error
  error           TEXT,                  -- 错误信息
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conv_id ON messages(conversation_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);

-- 3. 工作流生成历史记录表
-- 只有用户点击"保存"后 saved = true，否则为草稿/临时记录
CREATE TABLE IF NOT EXISTS workflow_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,  -- 可能来自对话
  title           TEXT NOT NULL DEFAULT '未命名工作流',
  data            JSONB NOT NULL,        -- 工作流数据 { nodes, edges }
  saved           BOOLEAN NOT NULL DEFAULT false,  -- 是否已保存
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workflow_history_saved ON workflow_history(saved);
CREATE INDEX idx_workflow_history_created_at ON workflow_history(created_at DESC);

-- 4. updated_at 自动更新触发器
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_workflow_history_updated_at
  BEFORE UPDATE ON workflow_history
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 5. 开启 RLS（Row Level Security）
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_history ENABLE ROW LEVEL SECURITY;

-- 6. 允许匿名用户通过 anon key 访问（开发阶段简单策略）
--   生产环境建议加上用户身份校验
CREATE POLICY "Allow all on conversations"
  ON conversations FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all on messages"
  ON messages FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all on workflow_history"
  ON workflow_history FOR ALL
  USING (true)
  WITH CHECK (true);
