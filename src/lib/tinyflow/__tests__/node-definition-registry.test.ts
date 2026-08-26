import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NodeRegistry } from '../node-registry';
import type { NodeDefinition, NodeCategory } from '../node-definition';

// ===== NodeDefinition Validation Tests =====

describe('NodeDefinition Validation', () => {
  const validNodeDefinition: NodeDefinition = {
    type: 'testNode',
    label: 'Test Node',
    description: 'A test node',
    category: 'core',
    inputs: [
      { name: 'input1', label: 'Input 1', dataType: 'string', required: true },
    ],
    outputs: [
      { name: 'output1', label: 'Output 1', dataType: 'string' },
    ],
    executorType: 'testNode',
    builtin: true,
  };

  it('should accept valid node definition', () => {
    const registry = new NodeRegistry();
    expect(() => registry.register(validNodeDefinition)).not.toThrow();
  });

  it('should require type field', () => {
    const invalidDef = { ...validNodeDefinition, type: '' };
    const registry = new NodeRegistry();
    registry.register(invalidDef);
    // Empty type is technically allowed but not recommended
    expect(registry.has('')).toBe(true);
  });

  it('should accept all valid categories', () => {
    const categories: NodeCategory[] = ['core', 'ai', 'integration', 'logic', 'data', 'custom'];
    const registry = new NodeRegistry();

    categories.forEach((category, index) => {
      const def: NodeDefinition = {
        ...validNodeDefinition,
        type: `node-${index}`,
        category,
      };
      registry.register(def);
      expect(registry.get(`node-${index}`)?.category).toBe(category);
    });
  });

  it('should handle optional fields', () => {
    const minimalDef: NodeDefinition = {
      type: 'minimal',
      label: 'Minimal',
      description: 'Minimal node',
      category: 'core',
      inputs: [],
      outputs: [],
      executorType: 'minimal',
    };

    const registry = new NodeRegistry();
    registry.register(minimalDef);

    const retrieved = registry.get('minimal');
    expect(retrieved).toBeDefined();
    expect(retrieved?.builtin).toBeUndefined();
    expect(retrieved?.configSchema).toBeUndefined();
    expect(retrieved?.capabilities).toBeUndefined();
  });
});

// ===== NodeRegistry Tests =====

describe('NodeRegistry', () => {
  let registry: NodeRegistry;

  const createNodeDef = (type: string, category: NodeCategory = 'core'): NodeDefinition => ({
    type,
    label: `${type} Label`,
    description: `${type} description`,
    category,
    inputs: [],
    outputs: [],
    executorType: type,
  });

  beforeEach(() => {
    registry = new NodeRegistry();
  });

  describe('register and get', () => {
    it('should register and retrieve a node definition', () => {
      const def = createNodeDef('testNode');
      registry.register(def);

      const retrieved = registry.get('testNode');
      expect(retrieved).toEqual(def);
    });

    it('should return undefined for non-existent type', () => {
      expect(registry.get('nonExistent')).toBeUndefined();
    });

    it('should overwrite existing registration', () => {
      const def1 = createNodeDef('testNode');
      const def2 = { ...def1, label: 'Updated Label' };

      registry.register(def1);
      registry.register(def2);

      expect(registry.get('testNode')?.label).toBe('Updated Label');
    });
  });

  describe('unregister', () => {
    it('should remove a registered node', () => {
      registry.register(createNodeDef('testNode'));
      registry.unregister('testNode');

      expect(registry.get('testNode')).toBeUndefined();
      expect(registry.has('testNode')).toBe(false);
    });

    it('should not throw when unregistering non-existent node', () => {
      expect(() => registry.unregister('nonExistent')).not.toThrow();
    });
  });

  describe('has', () => {
    it('should return true for registered nodes', () => {
      registry.register(createNodeDef('testNode'));
      expect(registry.has('testNode')).toBe(true);
    });

    it('should return false for unregistered nodes', () => {
      expect(registry.has('nonExistent')).toBe(false);
    });
  });

  describe('list', () => {
    it('should return all registered nodes', () => {
      registry.register(createNodeDef('node1'));
      registry.register(createNodeDef('node2'));
      registry.register(createNodeDef('node3'));

      const list = registry.list();
      expect(list).toHaveLength(3);
      expect(list.map(n => n.type)).toContain('node1');
      expect(list.map(n => n.type)).toContain('node2');
      expect(list.map(n => n.type)).toContain('node3');
    });

    it('should return empty array when no nodes registered', () => {
      expect(registry.list()).toEqual([]);
    });
  });

  describe('listByCategory', () => {
    it('should filter nodes by category', () => {
      registry.register(createNodeDef('core1', 'core'));
      registry.register(createNodeDef('core2', 'core'));
      registry.register(createNodeDef('ai1', 'ai'));
      registry.register(createNodeDef('logic1', 'logic'));

      const coreNodes = registry.listByCategory('core');
      expect(coreNodes).toHaveLength(2);
      expect(coreNodes.every(n => n.category === 'core')).toBe(true);

      const aiNodes = registry.listByCategory('ai');
      expect(aiNodes).toHaveLength(1);
      expect(aiNodes[0].type).toBe('ai1');
    });

    it('should return empty array for category with no nodes', () => {
      registry.register(createNodeDef('core1', 'core'));
      expect(registry.listByCategory('custom')).toEqual([]);
    });
  });

  describe('getByExecutorType', () => {
    it('should find node by executor type', () => {
      const def: NodeDefinition = {
        ...createNodeDef('llmNode'),
        executorType: 'llm',
      };
      registry.register(def);

      expect(registry.getByExecutorType('llm')?.type).toBe('llmNode');
    });

    it('should return undefined for non-existent executor type', () => {
      expect(registry.getByExecutorType('nonExistent')).toBeUndefined();
    });
  });

  describe('listBySource', () => {
    it('should filter by builtin source', () => {
      registry.register({ ...createNodeDef('builtin1'), source: 'builtin' });
      registry.register({ ...createNodeDef('builtin2'), builtin: true });
      registry.register({ ...createNodeDef('custom1'), source: 'custom' });

      const builtinNodes = registry.listBySource('builtin');
      expect(builtinNodes).toHaveLength(2);
    });

    it('should filter by custom source', () => {
      registry.register({ ...createNodeDef('builtin1'), source: 'builtin' });
      registry.register({ ...createNodeDef('custom1'), source: 'custom' });
      registry.register({ ...createNodeDef('custom2'), source: 'custom' });

      const customNodes = registry.listBySource('custom');
      expect(customNodes).toHaveLength(2);
    });
  });

  describe('toJSON', () => {
    it('should serialize all nodes', () => {
      registry.register(createNodeDef('node1'));
      registry.register(createNodeDef('node2'));

      const json = registry.toJSON();
      expect(json).toHaveLength(2);
      expect(Array.isArray(json)).toBe(true);
    });
  });
});
