'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, Clock, ChevronDown, ChevronRight, BrainCircuit } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { parseFlowTrace, getNodeLabel, formatDuration } from '@/lib/flow-trace';
import type { TraceNodeEvent } from '@/lib/flow-trace';

// ===== 节点级执行追踪视图 =====
// 竖向时间线：每个节点一行（状态图标 + 节点名 + 耗时），点击展开详情
// 数据源：flow events（node_start/node_complete 配对）+ flowData（节点名映射）
// 用于：画布执行面板（实时）+ 执行历史回看（静态）

export function FlowTraceView({
  events,
  flowData,
  flowStatus,
}: {
  events: TraceNodeEvent[];
  flowData: { nodes?: Array<{ id: string; type: string; data?: Record<string, unknown> }> } | null;
  /** 整体流程状态：running/completed/failed/paused */
  flowStatus?: string;
}) {
  const t = useT();
  const nodes = useMemo(() => parseFlowTrace(events), [events]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (nodes.length === 0) {
    return (
      <div className="space-y-3">
        {events.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {t('workflows.noExecutionRecords')}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {nodes.map((node) => {
        const { title, type } = getNodeLabel(flowData, node.nodeId);
        const expanded = expandedId === node.nodeId;
        const running = node.status === 'running';
        const outputs = node.outputs ?? {};

        return (
          <div key={node.nodeId} className="relative">
            {/* 连线 */}
            {node.order > 0 && (
              <div className="absolute -top-4 left-[11px] h-4 w-px bg-border" />
            )}

            <div
              className={cn(
                'group flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-muted/40',
                expanded && 'bg-muted/30',
              )}
              onClick={() => setExpandedId(expanded ? null : node.nodeId)}
            >
              <span className="shrink-0">
                {node.status === 'success' ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : node.status === 'failed' ? (
                  <XCircle className="h-4 w-4 text-red-500" />
                ) : running ? (
                  <Loader2 className="h-4 w-4 animate-spin text-[#b77945]" />
                ) : (
                  <Clock className="h-4 w-4 text-muted-foreground" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
              {type && (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {type}
                </span>
              )}
              <span
                className={cn(
                  'shrink-0 text-xs tabular-nums',
                  node.status === 'failed'
                    ? 'text-red-500'
                    : running
                      ? 'text-[#b77945]'
                      : 'text-muted-foreground',
                )}
              >
                {running ? '…' : formatDuration(node.duration)}
              </span>
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
            </div>

            {/* 展开详情 */}
            {expanded && (
              <div className="ml-6 space-y-2 rounded-md border border-border bg-card p-2.5 text-xs">
                {/* 状态 + 耗时 + 模型 + tokens */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                  <span>
                    {t('canvas.traceStatus')}:{' '}
                    <span
                      className={cn(
                        'font-medium',
                        node.status === 'failed' ? 'text-red-500' : 'text-green-600',
                      )}
                    >
                      {node.status === 'success'
                        ? t('canvas.traceSuccess')
                        : node.status === 'failed'
                          ? t('canvas.traceFailed')
                          : node.status === 'waiting_confirm'
                            ? t('canvas.traceWaiting')
                            : t('canvas.traceRunning')}
                    </span>
                  </span>
                  <span>
                    {t('canvas.traceDuration')}: {formatDuration(node.duration)}
                  </span>
                  {type === 'llmNode' && (
                    <>
                      <span className="inline-flex items-center gap-1">
                        <BrainCircuit className="h-3 w-3" />
                        {(() => {
                          const llmId = flowData?.nodes?.find((n) => n.id === node.nodeId)?.data
                            ?.llmId as string | undefined;
                          return llmId || '-';
                        })()}
                      </span>
                      {typeof (outputs as Record<string, unknown>).tokens === 'number' && (
                        <span>
                          {t('canvas.traceTokens')}: {String((outputs as Record<string, unknown>).tokens)}
                        </span>
                      )}
                    </>
                  )}
                </div>

                {node.error && (
                  <div className="break-all rounded bg-red-50 p-2 text-red-700 dark:bg-red-950 dark:text-red-300">
                    {node.error}
                  </div>
                )}

                {Object.keys(outputs).length > 0 && (
                  <div>
                    <p className="mb-1 font-medium text-muted-foreground">{t('canvas.traceOutput')}</p>
                    <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono">
                      {JSON.stringify(outputs, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* 整体状态 */}
      {flowStatus && (
        <div className="mt-2 flex items-center gap-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
          {flowStatus === 'running' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#b77945]" />
          ) : flowStatus === 'failed' ? (
            <XCircle className="h-3.5 w-3.5 text-red-500" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
          )}
          <span>{t(`canvas.traceFlow${flowStatus.charAt(0).toUpperCase()}${flowStatus.slice(1)}`)}</span>
        </div>
      )}
    </div>
  );
}
