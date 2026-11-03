import { describe, it, expect, vi } from 'vitest';
import { runFlow } from '@/lib/tinyflow/runFlow';
import type { TinyflowData } from '@/lib/tinyflow/types';

function simpleFlow(): TinyflowData {
  return {
    nodes: [
      {
        id: 'start',
        type: 'startNode',
        data: { parameters: [{ id: 'p1', name: 'query', dataType: 'String', refType: 'input' }] },
      },
      {
        id: 'end',
        type: 'endNode',
        data: { parameters: [{ id: 'e1', name: 'result', refType: 'ref', ref: 'start.query' }] },
      },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
  } as TinyflowData;
}

/**
 * 任务队列接入 runFlow 的契约：
 * - 外部指定 flowId（Worker 预分配，崩溃前后可关联）
 * - jobId / traceId 透传到执行记录
 * - checkpoint 回调透传给任务队列
 *
 * 说明：这里不依赖数据库（saveFlowRun 内部吞掉落库失败），
 * 落库字段本身由 SQL 迁移与集成测试覆盖。
 */
describe('runFlow 与任务队列的衔接', () => {
  it('使用外部指定的 flowId 作为执行 id', async () => {
    const result = await runFlow(simpleFlow(), { query: 'hello' }, {
      source: 'worker',
      flowId: '00000000-0000-4000-8000-000000000001',
      jobId: 'job-1',
    });

    expect(result.flowId).toBe('00000000-0000-4000-8000-000000000001');
    expect(result.status).toBe('completed');
  });

  it('节点完成后回调 checkpoint（供任务级恢复）', async () => {
    const onCheckpoint = vi.fn();

    const result = await runFlow(simpleFlow(), { query: 'hello' }, {
      source: 'worker',
      flowId: '00000000-0000-4000-8000-000000000002',
      onCheckpoint,
    });

    expect(result.status).toBe('completed');
    expect(onCheckpoint).toHaveBeenCalled();
    const checkpoint = onCheckpoint.mock.calls[0][0] as Record<string, unknown>;
    expect(checkpoint.flowId).toBe('00000000-0000-4000-8000-000000000002');
  });

  it('解析 resumeCheckpoint 后跳过已完成节点', async () => {
    const checkpoint = {
      flowId: '00000000-0000-4000-8000-000000000003',
      workflowVersion: 1,
      state: 'running',
      inputs: { query: 'hello' },
      nodeOutputs: { start: { query: 'hello' } },
      nodeStatuses: { start: 'success' },
      variables: {},
      userId: null,
      startedAt: Date.now(),
      executedNodes: ['start'],
      readyNodes: ['end'],
      lastUpdatedAt: Date.now(),
    };

    const result = await runFlow(
      simpleFlow(),
      { query: 'hello' },
      {
        source: 'worker',
        flowId: '00000000-0000-4000-8000-000000000003',
        resumeCheckpoint: checkpoint,
      },
    );

    expect(result.status).toBe('completed');
  });
});
