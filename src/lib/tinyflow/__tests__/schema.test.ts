import { describe, it, expect } from 'vitest';
import { validateWorkflow, serializeWorkflow, migrateWorkflow } from '../schema';
import type { TinyflowData } from '../types';

function validFlow(): TinyflowData {
  return {
    nodes: [
      { id: 'start', type: 'startNode', data: {} },
      { id: 'end', type: 'endNode', data: {} },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
    viewport: { x: 0, y: 0, zoom: 1 },
  } as unknown as TinyflowData;
}

describe('validateWorkflow', () => {
  it('合法工作流通过', () => {
    const r = validateWorkflow(validFlow());
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('非对象数据拒绝', () => {
    expect(validateWorkflow(null).valid).toBe(false);
    expect(validateWorkflow('x').valid).toBe(false);
  });

  it('缺少 nodes / edges 拒绝', () => {
    expect(validateWorkflow({}).valid).toBe(false);
  });

  it('未知节点类型拒绝', () => {
    const flow = validFlow();
    flow.nodes.push({ id: 'x', type: 'ghostNode', data: {} } as never);
    const r = validateWorkflow(flow);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === 'unknown_type')).toBe(true);
  });

  it('重复节点 id 拒绝', () => {
    const flow = validFlow();
    flow.nodes.push({ id: 'start', type: 'llmNode', data: {} } as never);
    expect(validateWorkflow(flow).errors.some((e) => e.code === 'duplicate_id')).toBe(true);
  });

  it('悬空连接（指向不存在节点）拒绝', () => {
    const flow = validFlow();
    flow.edges.push({ id: 'e2', source: 'start', target: 'ghost' } as never);
    expect(validateWorkflow(flow).errors.some((e) => e.code === 'dangling_edge')).toBe(true);
  });

  it('自环连接拒绝', () => {
    const flow = validFlow();
    flow.edges.push({ id: 'e2', source: 'start', target: 'start' } as never);
    expect(validateWorkflow(flow).errors.some((e) => e.code === 'self_loop')).toBe(true);
  });

  it('循环依赖拒绝', () => {
    const flow = {
      nodes: [
        { id: 'start', type: 'startNode', data: {} },
        { id: 'a', type: 'llmNode', data: {} },
        { id: 'b', type: 'llmNode', data: {} },
        { id: 'end', type: 'endNode', data: {} },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'a' },
        { id: 'e2', source: 'a', target: 'b' },
        { id: 'e3', source: 'b', target: 'a' },
        { id: 'e4', source: 'a', target: 'end' },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    } as unknown as TinyflowData;
    expect(validateWorkflow(flow).errors.some((e) => e.code === 'cycle')).toBe(true);
  });

  it('缺少开始/结束节点拒绝', () => {
    const flow = validFlow();
    flow.nodes = flow.nodes.filter((n) => n.type !== 'startNode');
    expect(validateWorkflow(flow).errors.some((e) => e.code === 'missing_start')).toBe(true);
  });
});

describe('serializeWorkflow / migrateWorkflow', () => {
  it('序列化补充 metadata', () => {
    const s = serializeWorkflow(validFlow(), { title: '测试' });
    expect(s.metadata.schemaVersion).toBe(1);
    expect(s.metadata.title).toBe('测试');
  });

  it('迁移补充缺失的 viewport', () => {
    const m = migrateWorkflow({ nodes: [], edges: [] });
    expect(m.viewport).toBeDefined();
  });
});

describe('开始/结束节点单例', () => {
  it('多个开始节点拒绝', () => {
    const flow = validFlow();
    flow.nodes.push({ id: 'start2', type: 'startNode', data: {} } as never);
    const r = validateWorkflow(flow);
    expect(r.errors.some((e) => e.code === 'duplicate_start')).toBe(true);
  });

  it('多个结束节点拒绝', () => {
    const flow = validFlow();
    flow.nodes.push({ id: 'end2', type: 'endNode', data: {} } as never);
    const r = validateWorkflow(flow);
    expect(r.errors.some((e) => e.code === 'duplicate_end')).toBe(true);
  });
});
