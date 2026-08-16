// ===== 确定性意图预分流 =====
// 在调用 LLM 前用轻量关键词判断用户意图，按模式动态组装 prompt 与工具：
// - query（查询/排错）：带只读工具
// - generate（创建工作流）：不带工具，专注输出工作流 JSON（消除工具误调用）
// - chat（闲聊/其它）：不带工具，完整对话能力
// 优先级：query > generate > chat（查询词更明确，避免"我的工作流"被误判为生成）

export type ChatIntent = 'query' | 'generate' | 'chat';

// 查询/排错关键词
const QUERY_KEYWORDS = [
  '查', '查询', '看看', '我的工作流', '我的流程', '我的知识库', '我的资料', '知识库里的',
  '知识库', '有哪些', '为什么', '报错', '错误', '日志', '调用记录', '发布状态', '发布了吗',
  '排错', '排查', '失败', '原因', '怎么回事', '状态', 'key', '密钥', '版本',
  '统计', '审计', '用户列表', '有哪些用户', '模型配置', '配置模型', '配置',
];

// 生成工作流关键词
const GENERATE_KEYWORDS = [
  '创建', '生成', '做一个', '帮我做', '设计', '实现', '搭建',
  '写一个', '开发', '做一个流程', '设计一个', '创建一个',
];

export function detectIntent(text: string): ChatIntent {
  const t = (text || '').toLowerCase();
  if (QUERY_KEYWORDS.some((k) => t.includes(k))) return 'query';
  if (GENERATE_KEYWORDS.some((k) => t.includes(k))) return 'generate';
  return 'chat';
}

// 从对话历史中取最后一条用户消息做意图判断
export function detectIntentFromMessages(
  messages: Array<{ role: string; content: unknown }>,
): ChatIntent {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      const content = Array.isArray(messages[i].content)
        ? String(
            (messages[i].content as Array<{ text?: string }>)
              .map((p) => p.text || '')
              .join(' '),
          )
        : String(messages[i].content);
      return detectIntent(content);
    }
  }
  return 'chat';
}
