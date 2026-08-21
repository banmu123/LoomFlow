import { supabase } from '@/lib/supabase/server';

// ===== 对话趋势分析 =====
// 从用户最近的对话历史中提取关注方向和主题，
// 注入 AI 系统提示词，让 AI 成为真正懂用户的人生设计教练。
// 不调用 LLM（避免额外开销），用轻量关键词/启发式方式提取。

const TOPIC_KEYWORDS: Array<{ topic: string; keywords: string[] }> = [
  { topic: '职业发展', keywords: ['职业', '工作', '跳槽', '晋升', '面试', '简历', 'offer', '转行', '薪资', '升职', '裁员', '创业'] },
  { topic: '学习成长', keywords: ['学习', '学 ', '教程', '课程', '读书', '读书笔记', '知识', '技能', '提升自己', '精进', '报班'] },
  { topic: 'AI 应用', keywords: ['AI', '人工智能', '大模型', 'GPT', '提示词', 'prompt', '智能体', '自动化', '机器学习', '深度学习'] },
  { topic: '编程技术', keywords: ['代码', '编程', '开发', 'bug', '报错', '后端', '前端', '算法', '数据库', 'api', '接口', '部署', 'GitHub', 'python', 'java'] },
  { topic: '内容创作', keywords: ['写作', '文章', '内容', '视频', '脚本', '文案', '公众号', '小红书', '抖音', '博主', '创作', 'IP'] },
  { topic: '身心健康', keywords: ['焦虑', '压力', '失眠', '健康', '运动', '健身', '减肥', '情绪', '抑郁', '疲惫', '累', '躺平', '内耗'] },
  { topic: '人际关系', keywords: ['同事', '领导', '老板', '朋友', '家人', '沟通', '相处', '社交', '合不来', '关系'] },
  { topic: '生活规划', keywords: ['买房', '结婚', '育儿', '孩子', '生活', '未来', '规划', '方向', '迷茫', '目标'] },
  { topic: '商业赚钱', keywords: ['赚钱', '副业', '兼职', '变现', '生意', '商业', '市场', '客户', '销售', '收入'] },
  { topic: '时间管理', keywords: ['效率', '时间', '拖延', '专注', '习惯', '计划', '安排', '自律', '清单'] },
];

interface TopicStat {
  topic: string;
  count: number;
}

/** 从文本中提取关注主题（关键词匹配计数） */
export function extractTopicsFromText(text: string): TopicStat[] {
  const normalized = text.toLowerCase();
  const stats = new Map<string, number>();
  for (const { topic, keywords } of TOPIC_KEYWORDS) {
    let count = 0;
    for (const kw of keywords) {
      const lowerKw = kw.toLowerCase();
      let idx = 0;
      while ((idx = normalized.indexOf(lowerKw, idx)) !== -1) {
        count++;
        idx += lowerKw.length;
      }
    }
    if (count > 0) stats.set(topic, count);
  }
  return [...stats.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count);
}

export interface ConversationTrend {
  topics: TopicStat[];
  messageCount: number;
  conversationCount: number;
}

/** 读取用户最近 N 天的对话，提取关注主题 */
export async function analyzeConversationTrends(
  userId: string,
  days: number = 30,
): Promise<ConversationTrend> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    const [convRes, msgRes] = await Promise.all([
      supabase
        .from('conversations')
        .select('id')
        .eq('user_id', userId)
        .gte('updated_at', since),
      supabase
        .from('messages')
        .select('content')
        .eq('user_id', userId)
        .eq('role', 'user')
        .gte('created_at', since),
    ]);

    const messages = (msgRes.data ?? []) as Array<{ content: string }>;
    const allText = messages
      .map((m) => m.content ?? '')
      .filter(Boolean)
      .join('\n');

    const topics = allText ? extractTopicsFromText(allText) : [];
    return {
      topics: topics.slice(0, 5),
      messageCount: messages.length,
      conversationCount: (convRes.data ?? []).length,
    };
  } catch {
    return { topics: [], messageCount: 0, conversationCount: 0 };
  }
}
