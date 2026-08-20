// ===== 节点级执行追踪：events → 节点执行序列（纯函数，可单测）=====

export interface TraceNodeEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export interface TraceNode {
  nodeId: string;
  status: 'success' | 'failed' | 'waiting_confirm' | 'running' | 'waiting';
  /** 开始时间（ms） */
  startedAt: number | null;
  /** 结束时间（ms） */
  completedAt: number | null;
  duration: number | null;
  outputs?: Record<string, unknown>;
  error?: string;
  /** 节点顺序（按开始时间） */
  order: number;
}

/** 从 events 解析节点执行序列（node_start/node_complete 配对，按时间排序还原顺序） */
export function parseFlowTrace(events: TraceNodeEvent[]): TraceNode[] {
  const byId = new Map<string, { startedAt: number | null; completed: TraceNodeEvent | null }>();
  const order: string[] = [];

  for (const ev of [...events].sort((a, b) => a.timestamp - b.timestamp)) {
    const nodeId = ev.data?.nodeId as string | undefined;
    if (!nodeId) continue;
    if (ev.type === 'node_start') {
      if (!byId.has(nodeId)) {
        byId.set(nodeId, { startedAt: ev.timestamp, completed: null });
        order.push(nodeId);
      }
    } else if (ev.type === 'node_complete') {
      const entry = byId.get(nodeId);
      if (entry) {
        entry.completed = ev;
      } else {
        byId.set(nodeId, { startedAt: null, completed: ev });
        order.push(nodeId);
      }
    }
  }

  return order.map((nodeId, idx) => {
    const entry = byId.get(nodeId)!;
    const completed = entry.completed;
    const status = completed?.data?.status as TraceNode['status'] | undefined;
    const finished = completed
      ? status === 'failed'
        ? 'failed'
        : status === 'waiting_confirm'
          ? 'waiting_confirm'
          : 'success'
      : 'running';
    const duration =
      completed && typeof completed.data?.duration === 'number'
        ? (completed.data.duration as number)
        : entry.startedAt && completed
          ? completed.timestamp - entry.startedAt
          : null;
    return {
      nodeId,
      status: finished,
      startedAt: entry.startedAt,
      completedAt: completed?.timestamp ?? null,
      duration,
      outputs: (completed?.data?.outputs as Record<string, unknown> | undefined) ?? undefined,
      error: (completed?.data?.error as string | undefined) ?? undefined,
      order: idx,
    };
  });
}

/** 从 flowData 节点列表取节点标题（title || type）与类型 */
export function getNodeLabel(
  flowData: { nodes?: Array<{ id: string; type: string; data?: Record<string, unknown> }> } | null,
  nodeId: string,
): { title: string; type: string } {
  const node = flowData?.nodes?.find((n) => n.id === nodeId);
  if (!node) return { title: nodeId, type: '' };
  const title = (node.data?.title as string | undefined) || node.type;
  return { title, type: node.type };
}

/** 耗时格式化：<1s 显示 ms，否则显示 s */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
