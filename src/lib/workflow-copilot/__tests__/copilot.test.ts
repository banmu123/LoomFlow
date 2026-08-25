import { describe, it, expect } from 'vitest';
import { evaluateOutput, evaluateRule, getByPath } from '../evaluation';
import { diffWorkflow, diffToMarkdown } from '../diff';
import { applyPatch } from '../patch';
import { checkDependencies } from '../dependency';
import { buildProposal } from '../proposal';
import { buildCopilotContext, contextToPrompt } from '../context';
import { runTestCase } from '../test-case';
import { runWorkflow } from '../runner';
import type { TinyflowData } from '../../tinyflow/types';

function flow(): TinyflowData {
  return {
    nodes: [
      { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: { title: '开始', parameters: [] } as never },
      { id: 'code', type: 'codeNode', position: { x: 0, y: 0 }, data: { title: '处理', code: 'return "AI utils ready";' } as never },
      { id: 'end', type: 'endNode', position: { x: 0, y: 0 }, data: { title: '结束', parameters: [{ id: 'o2', name: 'final', refType: 'ref', ref: 'code.output' }] } as never },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'code' },
      { id: 'e2', source: 'code', target: 'end' },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  } as TinyflowData;
}

describe('Part 2: Output Evaluation（确定性）', () => {
  it('exact_match：对象深比较', () => {
    const s = evaluateOutput({ a: 1, b: { c: 2 } }, [
      { type: 'exact_match', path: '$', value: { a: 1, b: { c: 2 } } },
    ]);
    expect(s.overall).toBe('pass');
  });

  it('contains：字符串包含', () => {
    expect(evaluateRule({ text: 'www AI helper' }, { type: 'contains', path: '$.text', value: 'AI' }).success).toBe(true);
    expect(evaluateRule({ text: 'hello' }, { type: 'contains', path: '$.text', value: 'AI' }).success).toBe(false);
  });

  it('json_path：取路径后比较', () => {
    expect(evaluateRule({ root: { summary: 'ok' } }, { type: 'json_path', path: '$.root.summary', value: 'ok' }).success).toBe(true);
  });

  it('numeric_tolerance：绝对值容差', () => {
    expect(evaluateRule({ v: 9.2 }, { type: 'numeric_tolerance', path: '$.v', value: 10, tolerance: 1 }).success).toBe(true);
    expect(evaluateRule({ v: 7 }, { type: 'numeric_tolerance', path: '$.v', value: 10, tolerance: 1 }).success).toBe(false);
  });

  it('array_contains：数组包含元素', () => {
    expect(evaluateRule({ list: [1, 2, 3] }, { type: 'array_contains', path: '$.list', value: 2 }).success).toBe(true);
  });

  it('json_schema：必填字段', () => {
    expect(evaluateRule({ obj: { name: 'x' } }, { type: 'json_schema', path: '$.obj', required: ['name'] }).success).toBe(true);
    expect(evaluateRule({ obj: {} }, { type: 'json_schema', path: '$.obj', required: ['name'] }).success).toBe(false);
  });

  it('getByPath：点路径与数组下标', () => {
    expect(getByPath({ a: [{ b: 1 }] }, '$.a[0].b')).toBe(1);
  });
});

describe('Part 3: Workflow Diff', () => {
  it('检测新增/更新节点与边', () => {
    const before = flow();
    const after = flow();
    // 新增一个节点
    after.nodes.push({ id: 'n2', type: 'templateNode', position: { x: 1, y: 2 }, data: { title: '新节点' } as never });
    after.edges.push({ id: 'e3', source: 'code', target: 'n2' });
    // 更新 code 节点的 title
    (after.nodes[1].data as Record<string, unknown>).title = '改后';

    const d = diffWorkflow(before, after);
    expect(d.operations.some((o) => o.op === 'add_node' && o.nodeId === 'n2')).toBe(true);
    expect(d.operations.some((o) => o.op === 'add_edge')).toBe(true);
    expect(d.operations.some((o) => o.op === 'update_node' && o.nodeId === 'code')).toBe(true);
    expect(diffToMarkdown(d)).toContain('统计');
  });

  it('检测删除节点', () => {
    const before = flow();
    const after = flow();
    after.nodes = after.nodes.filter((n) => n.id !== 'code');
    after.edges = after.edges.filter((e) => e.source !== 'code' && e.target !== 'code');
    const d = diffWorkflow(before, after);
    expect(d.operations.some((o) => o.op === 'remove_node' && o.nodeId === 'code')).toBe(true);
  });
});

describe('Part 4: AI Workflow Patch', () => {
  it('add_node + connect 组合', () => {
    const base = flow();
    const r = applyPatch(base, [
      { op: 'add_node', node: { id: 'dedupe', type: 'codeNode', position: { x: 10, y: 10 }, data: { title: '去重', code: 'return { out: true };' } } },
      { op: 'disconnect', edgeId: 'e2' },
      { op: 'connect', edge: { source: 'code', target: 'dedupe' } },
      { op: 'connect', edge: { source: 'dedupe', target: 'end' } },
    ]);
    expect(r.errors).toHaveLength(0);
    expect(r.workflow.nodes.some((n) => n.id === 'dedupe')).toBe(true);
    expect(r.workflow.edges.some((e) => e.source === 'dedupe' && e.target === 'end')).toBe(true);
    // 原始 flow 不被修改（不可变语义）
    expect(base.nodes.some((n) => n.id === 'dedupe')).toBe(false);
  });

  it('remove_node 连带清理相关边', () => {
    const r = applyPatch(flow(), [{ op: 'remove_node', nodeId: 'code' }]);
    const edges = r.workflow.edges;
    expect(edges.every((e) => e.source !== 'code' && e.target !== 'code')).toBe(true);
  });

  it('replace_node 迁移边引用', () => {
    const r = applyPatch(flow(), [{ op: 'replace_node', nodeId: 'code', node: { id: 'newcode', type: 'codeNode', data: { title: '新', code: 'return { x: 1 };' } } }]);
    expect(r.errors).toHaveLength(0);
    expect(r.workflow.edges.some((e) => e.source === 'newcode')).toBe(true);
    expect(r.workflow.nodes.some((n) => n.id === 'code')).toBe(false);
  });
});

describe('Part 5: Patch Validation Pipeline', () => {
  it('buildProposal：schema + 依赖 + diff', async () => {
    const proposal = await buildProposal(flow(), [
      { op: 'add_node', node: { id: 'dedupe', type: 'codeNode', data: { title: '去重', code: 'return { out: true };' } } },
      { op: 'connect', edge: { source: 'code', target: 'dedupe' } },
      { op: 'connect', edge: { source: 'dedupe', target: 'end' } },
    ], { workflowId: 'w1', fromVersion: 1 });
    expect(proposal.schema.valid).toBe(true);
    expect(proposal.diff.operations.some((o) => o.op === 'add_node')).toBe(true);
  });

  it('buildProposal：未知节点类型触发 schema/dependency 问题', async () => {
    const proposal = await buildProposal(flow(), [
      { op: 'add_node', node: { id: 'ghost', type: 'GhostNode', data: { title: 'x' } } },
    ], { workflowId: 'w1' });
    expect(proposal.schema.valid).toBe(false);
    expect(proposal.issues.some((i) => i.code === 'unknown_executor')).toBe(true);
  });
});

describe('Part 7: Copilot Context（裁剪）', () => {
  it('buildCopilotContext 按任务裁剪并只加载必要来源', () => {
    const ctx = buildCopilotContext('debug', 'w1', {
      workflow: flow(),
      version: 2,
      recentRuns: [{ status: 'failed', error: 'x'.repeat(1000), created_at: '2026-08-25' }],
      trace: { nodes: [{ nodeId: 'code', status: 'failed' }] },
      tests: [({ id: 't1', name: 'case1' } as never)],
    });
    expect(ctx.loaded).toContain('workflow');
    expect(ctx.loaded).toContain('recentRuns');
    expect(ctx.loaded).toContain('trace');
    expect(contextToPrompt(ctx)).toContain('最近运行');
  });

  it('create 任务不加载运行/trace/tests', () => {
    const ctx = buildCopilotContext('create', undefined, {
      workflow: flow(),
      recentRuns: [{ status: 'failed' }],
      trace: {},
    });
    expect(ctx.sources.recentRuns).toBeUndefined();
    expect(ctx.sources.trace).toBeUndefined();
  });
});

describe('Part 1: Test Runner（真实 Runtime）', () => {
  it('runTestCase：正常通过', async () => {
    const result = await runTestCase(flow(), {
      id: 'tc1',
      workflowId: 'w1',
      name: 'summary 包含 AI',
      inputs: {},
      evaluationRules: [{ type: 'contains', path: '$.final', value: 'AI' }],
    });
    expect(result.status).toBe('passed');
    expect(result.outputs?.final).toBe('AI utils ready');
  }, 20000);

  it('runTestCase：断言失败', async () => {
    const result = await runTestCase(flow(), {
      id: 'tc2',
      workflowId: 'w1',
      name: '应为别的内容',
      inputs: {},
      evaluationRules: [{ type: 'contains', path: '$.final', value: '不存在' }],
    });
    expect(result.status).toBe('failed');
  }, 20000);

  it('runWorkflow：工作流失败返回 failed 而非抛错', async () => {
    const bad = {
      nodes: [
        { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: { title: 's', parameters: [] } as never },
        { id: 'f', type: 'codeNode', position: { x: 0, y: 0 }, data: { title: 'f', code: 'throw new Error("boom");' } as never },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'f' }],
      viewport: { x: 0, y: 0, zoom: 1 },
    } as TinyflowData;
    const r = await runWorkflow(bad, {});
    expect(r.status).toBe('failed');
    expect(r.error).toContain('boom');
  }, 20000);
});
