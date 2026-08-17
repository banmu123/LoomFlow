import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NodeDefinition } from '../node-definition';

const mocks = vi.hoisted(() => {
  const from = vi.fn();
  return { from };
});
vi.mock('@/lib/supabase/server', () => ({
  supabase: { from: mocks.from },
}));

// 用独立 registry 避免污染全局（node-custom 内部用全局 nodeRegistry——测试用 create/update 验证注册）
import { nodeRegistry } from '../node-registry';
import '../nodes/builtin'; // 注册官方节点（冲突检查依赖）
import { createCustomNode, updateCustomNode, deleteCustomNode } from '../node-custom';

function makeChain(terminal: () => Promise<unknown>) {
  const obj: Record<string, unknown> = {};
  ['select', 'eq', 'order', 'insert', 'update', 'delete', 'single', 'maybeSingle'].forEach((k) => {
    obj[k] = vi.fn(() => obj);
  });
  obj.then = (resolve: (v: unknown) => void) => terminal().then(resolve);
  return obj;
}

const DEF: NodeDefinition = {
  type: 'myCustomNode',
  label: '我的节点',
  description: '测试',
  category: 'custom',
  inputs: [{ name: 'input', label: '输入', dataType: 'string' }],
  outputs: [{ name: 'output', label: '输出', dataType: 'string' }],
  configSchema: [{ name: 'field', label: '字段', type: 'string' }],
  executorType: 'myCustomNode',
  source: 'custom',
};

beforeEach(() => {
  vi.clearAllMocks();
  nodeRegistry.unregister('myCustomNode');
  nodeRegistry.unregister('myCustomNode_copy');
});

describe('自定义节点库（node-custom）', () => {
  it('创建：插入 DB 并注册进 NodeRegistry（source: custom）', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'node_definitions') {
        return makeChain(async () => ({
          data: {
            id: 'n1', type: 'myCustomNode', label: '我的节点', description: '测试',
            category: 'custom', icon: null,
            inputs: DEF.inputs, outputs: DEF.outputs,
            config_schema: DEF.configSchema, capabilities: ['text'],
            version: 1, status: 'active', user_id: 'u1',
            created_at: 'x', updated_at: 'x',
          },
          error: null,
        }));
      }
      return makeChain(async () => ({ data: null, error: null }));
    });

    const result = await createCustomNode('u1', DEF);
    expect(result.error).toBeUndefined();
    expect(result.node?.source).toBe('custom');
    // 已注册（节点库面板自动可见）
    expect(nodeRegistry.get('myCustomNode')?.source).toBe('custom');
    expect(nodeRegistry.get('myCustomNode')?.configSchema?.[0].name).toBe('field');
  });

  it('创建：与官方节点类型冲突时拒绝', async () => {
    // 冲突检查在 insert 之前（无需 DB mock）
    const result = await createCustomNode('u1', { ...DEF, type: 'llmNode' });
    expect(result.error).toContain('已存在');
    // 不触发 DB 写入
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('创建：非法 type 拒绝', async () => {
    const result = await createCustomNode('u1', { ...DEF, type: '1bad-type' });
    expect(result.error).toBeTruthy();
  });

  it('更新：PATCH 后重新注册（覆盖旧定义）', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'node_definitions') {
        return makeChain(async () => ({
          data: {
            id: 'n1', type: 'myCustomNode', label: '新名称', description: '',
            category: 'custom', icon: null,
            inputs: DEF.inputs, outputs: DEF.outputs,
            config_schema: [{ name: 'newField', label: '新字段', type: 'string' }],
            capabilities: ['text'], version: 1, status: 'active', user_id: 'u1',
            created_at: 'x', updated_at: 'x',
          },
          error: null,
        }));
      }
      return makeChain(async () => ({ data: null, error: null }));
    });

    const result = await updateCustomNode('u1', 'n1', { label: '新名称', configSchema: [{ name: 'newField', label: '新字段', type: 'string' }] });
    expect(result.error).toBeUndefined();
    expect(result.node?.label).toBe('新名称');
    expect(nodeRegistry.get('myCustomNode')?.configSchema?.[0].name).toBe('newField');
  });

  it('删除：从 registry 注销', async () => {
    nodeRegistry.register({ ...DEF, source: 'custom' });
    mocks.from.mockImplementation(() => makeChain(async () => ({ data: null, error: null })));
    const result = await deleteCustomNode('u1', 'n1', 'myCustomNode');
    expect(result.error).toBeUndefined();
    expect(nodeRegistry.has('myCustomNode')).toBe(false);
  });
});
