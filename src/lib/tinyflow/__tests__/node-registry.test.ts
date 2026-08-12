import { describe, it, expect } from 'vitest';
import { NodeRegistry, nodeRegistry } from '../node-registry';
import type { NodeDefinition } from '../node-definition';
import '../nodes/builtin'; // 确保内置节点注册（与 index.ts 行为一致）

// 测试用独立 registry（避免污染全局单例）
function makeRegistry(): NodeRegistry {
  return new NodeRegistry();
}

function makeNode(overrides: Partial<NodeDefinition> = {}): NodeDefinition {
  return {
    type: 'testNode',
    label: '测试节点',
    description: '测试用',
    category: 'custom',
    inputs: [{ name: 'input', label: 'Input', dataType: 'string' }],
    outputs: [{ name: 'output', label: 'Output', dataType: 'string' }],
    executorType: 'testNode',
    builtin: false,
    ...overrides,
  };
}

describe('NodeRegistry 基础操作', () => {
  it('注册节点后可查询', () => {
    const registry = makeRegistry();
    registry.register(makeNode());
    expect(registry.get('testNode')).toBeDefined();
    expect(registry.get('testNode')?.label).toBe('测试节点');
  });

  it('未知节点返回 undefined / has 为 false', () => {
    const registry = makeRegistry();
    expect(registry.get('ghostNode')).toBeUndefined();
    expect(registry.has('ghostNode')).toBe(false);
  });

  it('重复注册同名节点覆盖（保留最新）', () => {
    const registry = makeRegistry();
    registry.register(makeNode({ label: 'v1' }));
    registry.register(makeNode({ label: 'v2' }));
    expect(registry.get('testNode')?.label).toBe('v2');
    expect(registry.list()).toHaveLength(1);
  });

  it('删除节点后不可查询', () => {
    const registry = makeRegistry();
    registry.register(makeNode());
    registry.unregister('testNode');
    expect(registry.get('testNode')).toBeUndefined();
    expect(registry.has('testNode')).toBe(false);
    expect(registry.list()).toHaveLength(0);
  });
});

describe('NodeRegistry 查询', () => {
  it('分类查询（listByCategory）', () => {
    const registry = makeRegistry();
    registry.register(makeNode({ type: 'llm', category: 'ai' }));
    registry.register(makeNode({ type: 'code', category: 'logic' }));
    registry.register(makeNode({ type: 'http', category: 'integration' }));
    registry.register(makeNode({ type: 'template', category: 'data' }));

    expect(registry.listByCategory('ai').map((n) => n.type)).toEqual(['llm']);
    expect(registry.listByCategory('logic').map((n) => n.type)).toEqual(['code']);
    expect(registry.listByCategory('core')).toHaveLength(0);
  });

  it('能力查询（capabilities 过滤）', () => {
    const registry = makeRegistry();
    registry.register(
      makeNode({ type: 'llm', capabilities: ['text', 'vision'] }),
    );
    registry.register(makeNode({ type: 'plain', capabilities: ['text'] }));

    const visionModels = registry
      .list()
      .filter((n) => n.capabilities?.includes('vision'));
    expect(visionModels.map((n) => n.type)).toEqual(['llm']);
  });
});

describe('内置节点注册（全局单例）', () => {
  it('10 个内置节点全部注册', () => {
    const types = nodeRegistry.list().map((n) => n.type).sort();
    expect(types).toEqual([
      'codeNode',
      'confirmNode',
      'endNode',
      'httpNode',
      'knowledgeNode',
      'llmNode',
      'loopNode',
      'searchEngineNode',
      'startNode',
      'templateNode',
    ]);
  });

  it('每个内置节点定义完整（必填字段齐全）', () => {
    for (const def of nodeRegistry.list()) {
      expect(def.type, def.label).toBeTruthy();
      expect(def.label, def.type).toBeTruthy();
      expect(def.description, def.type).toBeTruthy();
      expect(def.category, def.type).toBeTruthy();
      expect(Array.isArray(def.inputs), def.type).toBe(true);
      expect(Array.isArray(def.outputs), def.type).toBe(true);
      expect(def.executorType, def.type).toBeTruthy();
      expect(def.builtin, def.type).toBe(true);
    }
  });

  it('executorType 与 type 对应（可执行绑定）', () => {
    for (const def of nodeRegistry.list()) {
      expect(def.executorType, def.type).toBe(def.type);
    }
  });

  it('LLM 节点声明文本 + 视觉能力', () => {
    const llm = nodeRegistry.get('llmNode');
    expect(llm?.capabilities).toContain('text');
    expect(llm?.capabilities).toContain('vision');
  });

  it('开始/结束节点属于 core 分类', () => {
    expect(nodeRegistry.get('startNode')?.category).toBe('core');
    expect(nodeRegistry.get('endNode')?.category).toBe('core');
  });
});
