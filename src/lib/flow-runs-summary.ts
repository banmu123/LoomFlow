import { supabase } from '@/lib/supabase/server';
import { parseFlowTrace } from '@/lib/flow-trace';

// ===== 运行历史摘要（Debug Assistant 数据源）=====
// 查询最近 N 次运行（画布试运行 + API 调用），从 events 解析节点级摘要，
// 注入 AI 助手提示词——AI 可据此分析失败原因/定位瓶颈/给出修复建议。

export interface RunSummary {
  runId: string;
  status: string;
  createdAt: string;
  error: string | null;
  source: string;
  nodes: Array<{
    nodeId: string;
    status: string;
    duration: number | null;
    error?: string;
    /** 节点名（flow_data 快照映射；无快照时用 nodeId） */
    title: string;
    type: string;
  }>;
}

interface FlowRunRow {
  id: string;
  status: string;
  created_at: string;
  error: string | null;
  source: string;
  events: Array<{ type: string; data: Record<string, unknown>; timestamp: number }> | null;
  flow_data: { nodes?: Array<{ id: string; type: string; data?: Record<string, unknown> }> } | null;
}

const NODE_TITLE_HINT: Record<string, string> = {
  startNode: '开始',
  endNode: '结束',
  llmNode: 'LLM',
  httpNode: 'HTTP',
  codeNode: '代码',
  knowledgeNode: '知识库',
  searchEngineNode: '搜索',
  templateNode: '模板',
  conditionNode: '条件',
  confirmNode: '确认',
  loopNode: '循环',
  excelNode: 'Excel',
};

function nodeTitle(
  flowData: FlowRunRow['flow_data'],
  nodeId: string,
  type: string,
): string {
  const fromData = flowData?.nodes?.find((n) => n.id === nodeId)?.data?.title as
    | string
    | undefined;
  if (fromData) return fromData;
  return NODE_TITLE_HINT[type] || type || nodeId;
}

/** 单次运行 → 节点级摘要（复用 parseFlowTrace 解析 events） */
export function summarizeRunEvents(row: FlowRunRow): RunSummary {
  const trace = parseFlowTrace((row.events ?? []).map((e) => ({
    type: e.type,
    data: (e.data ?? {}) as Record<string, unknown>,
    timestamp: e.timestamp,
  })));
  const flowData = row.flow_data;
  return {
    runId: row.id,
    status: row.status,
    createdAt: row.created_at,
    error: row.error,
    source: row.source,
    nodes: trace.map((n) => {
      const type = flowData?.nodes?.find((x) => x.id === n.nodeId)?.type || '';
      return {
        nodeId: n.nodeId,
        status: n.status,
        duration: n.duration,
        error: n.error,
        title: nodeTitle(flowData, n.nodeId, type),
        type,
      };
    }),
  };
}

/** 运行摘要 → 注入提示词的文本块 */
export function summarizeRunsForPrompt(runs: RunSummary[]): string {
  if (runs.length === 0) return '（暂无运行记录）';
  const lines = runs.map((r) => {
    const nodes =
      r.nodes.length > 0
        ? r.nodes
            .map((n) =>
              `    - ${n.title}（${n.type || n.nodeId}）: ${n.status}${n.duration != null ? `, ${n.duration}ms` : ''}${n.error ? `, 错误: ${n.error.slice(0, 200)}` : ''}`,
            )
            .join('\n')
        : '    （无节点级数据）';
    return [
      `- Run #${r.runId.slice(0, 8)} | 状态: ${r.status} | 来源: ${r.source === 'api' ? 'API 调用' : '画布试运行'} | 时间: ${r.createdAt}`,
      r.error ? `  整体错误: ${r.error.slice(0, 300)}` : '',
      nodes,
    ]
      .filter(Boolean)
      .join('\n');
  });
  return lines.join('\n');
}

/** 查询最近运行（指定工作流优先，否则最近画布运行）并生成摘要文本 */
export async function buildRunsSummaryText(
  userId: string,
  workflowId?: string | null,
  limit = 5,
): Promise<string> {
  try {
    let query = supabase
      .from('flow_runs')
      .select('id, status, created_at, error, source, events, flow_data')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (workflowId) {
      query = query.eq('workflow_id', workflowId);
    } else {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;
    if (error || !data) return '（运行记录查询失败）';

    const rows = (data as FlowRunRow[]).map((r) => ({
      ...r,
      events: Array.isArray(r.events) ? r.events : null,
    }));
    if (rows.length === 0) return '（暂无运行记录）';

    const summaries = rows.map((r) => summarizeRunEvents(r));
    return summarizeRunsForPrompt(summaries);
  } catch {
    return '（运行记录查询失败）';
  }
}
