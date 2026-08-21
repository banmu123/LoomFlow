import { supabase } from '@/lib/supabase/server';

// ===== 行为洞察 =====
// 从用户真实行为（工作流创建/执行/节点使用）中提取模式，
// 生成人类可读的行为摘要，注入 AI 系统提示词——
// 让 AI 真正"看到"用户做了什么，而不只是泛泛地理解。

interface WorkflowRow {
  id: string;
  title: string | null;
  saved: boolean;
  published: boolean;
  data: { nodes?: Array<{ type: string }> } | null;
  created_at: string;
}

interface RunRow {
  status: string;
  created_at: string;
}

export interface BehaviorInsight {
  recentWorkflows: number;          // 近 7 天创建/保存的工作流数
  totalWorkflows: number;           // 总工作流数
  publishedCount: number;           // 已发布数
  runCount: number;                 // 执行次数
  successRate: number;              // 执行成功率 0-1
  nodeTypePrefs: Array<{ type: string; count: number }>; // 节点类型偏好（top）
  recentTitles: string[];           // 最近的工作流标题
  runTrend: 'up' | 'down' | 'flat'; // 近 7 天 vs 前 7 天执行趋势
}

export const NODE_TYPE_LABELS: Record<string, string> = {
  startNode: '开始',
  endNode: '结束',
  llmNode: 'AI 对话',
  httpNode: 'HTTP 请求',
  codeNode: '代码执行',
  knowledgeNode: '知识库',
  searchEngineNode: '网络搜索',
  templateNode: '模板',
  conditionNode: '条件判断',
  confirmNode: '人工确认',
  loopNode: '循环',
  excelNode: 'Excel',
};

/** 分析用户行为模式 */
export async function analyzeBehaviorInsights(userId: string): Promise<BehaviorInsight | null> {
  try {
    const now = Date.now();
    const days7 = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const days14 = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

    const [wfRes, runsRes] = await Promise.all([
      supabase
        .from('workflow_history')
        .select('id, title, saved, published, data, created_at')
        .eq('user_id', userId),
      supabase
        .from('flow_runs')
        .select('status, created_at')
        .eq('user_id', userId),
    ]);

    const workflows = (wfRes.data ?? []) as WorkflowRow[];
    const runs = (runsRes.data ?? []) as RunRow[];
    if (workflows.length === 0 && runs.length === 0) return null;

    const saved = workflows.filter((w) => w.saved);
    const recent7 = saved.filter((w) => w.created_at >= days7);
    const publishedCount = workflows.filter((w) => w.published).length;

    // 节点类型偏好
    const nodeCount = new Map<string, number>();
    for (const wf of saved) {
      const nodes = wf.data?.nodes;
      if (!Array.isArray(nodes)) continue;
      for (const node of nodes) {
        if (!node || typeof node.type !== 'string') continue;
        const type = node.type;
        if (type === 'startNode' || type === 'endNode') continue;
        nodeCount.set(type, (nodeCount.get(type) ?? 0) + 1);
      }
    }
    const nodeTypePrefs = [...nodeCount.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // 执行统计
    const runCount = runs.length;
    const completed = runs.filter((r) => r.status === 'completed').length;
    const successRate = runCount > 0 ? completed / runCount : 0;

    // 执行趋势
    const recent7Runs = runs.filter((r) => r.created_at >= days7).length;
    const prev7Runs = runs.filter((r) => r.created_at >= days14 && r.created_at < days7).length;
    const runTrend: 'up' | 'down' | 'flat' =
      recent7Runs > prev7Runs + 1 ? 'up' : recent7Runs < prev7Runs - 1 ? 'down' : 'flat';

    // 最近标题（近 7 天，最多 3 个）
    const recentTitles = [...recent7]
      .sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
      .map((w) => w.title || '未命名工作流')
      .slice(0, 3);

    return {
      recentWorkflows: recent7.length,
      totalWorkflows: saved.length,
      publishedCount,
      runCount,
      successRate,
      nodeTypePrefs,
      recentTitles,
      runTrend,
    };
  } catch {
    return null;
  }
}

/** 把行为洞察转成人类可读的描述文本（注入系统提示词） */
export function behaviorInsightToText(insight: BehaviorInsight): string {
  const lines: string[] = [];

  if (insight.recentWorkflows > 0) {
    const titlesStr = insight.recentTitles.length > 0
      ? `，如「${insight.recentTitles.join('」「')}」`
      : '';
    lines.push(`- 近 7 天创建/保存了 ${insight.recentWorkflows} 个工作流${titlesStr}`);
  }
  if (insight.totalWorkflows > 0) {
    lines.push(`- 累计 ${insight.totalWorkflows} 个工作流${insight.publishedCount > 0 ? `，其中 ${insight.publishedCount} 个已发布为 API` : ''}`);
  }
  if (insight.runCount > 0) {
    const rate = Math.round(insight.successRate * 100);
    lines.push(`- 共执行 ${insight.runCount} 次，成功率 ${rate}%${insight.runTrend === 'up' ? '，最近越来越频繁' : insight.runTrend === 'down' ? '，最近有所减少' : ''}`);
  }
  if (insight.nodeTypePrefs.length > 0) {
    const prefs = insight.nodeTypePrefs
      .map((p) => `${NODE_TYPE_LABELS[p.type] || p.type}${p.count > 1 ? `×${p.count}` : ''}`)
      .join('、');
    lines.push(`- 常用节点：${prefs}`);
  }

  if (lines.length === 0) return '';
  return lines.join('\n');
}
