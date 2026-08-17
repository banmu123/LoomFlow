import type { NodeCategory, NodeDefinition } from './node-definition';

// ===== NodeRegistry：统一注册/查询/获取节点定义 =====

export class NodeRegistry {
  private nodes = new Map<string, NodeDefinition>();

  register(definition: NodeDefinition): void {
    this.nodes.set(definition.type, definition);
  }

  unregister(type: string): void {
    this.nodes.delete(type);
  }

  get(type: string): NodeDefinition | undefined {
    return this.nodes.get(type);
  }

  list(): NodeDefinition[] {
    return [...this.nodes.values()];
  }

  /** 按分类查询节点定义 */
  listByCategory(category: NodeCategory): NodeDefinition[] {
    return this.list().filter((n) => n.category === category);
  }

  /** 按执行器类型查询（多节点类型共用同一执行器时使用） */
  getByExecutorType(executorType: string): NodeDefinition | undefined {
    return this.list().find((n) => n.executorType === executorType);
  }

  /** 按来源查询（builtin / custom——Plugin SDK 场景） */
  listBySource(source: 'builtin' | 'custom'): NodeDefinition[] {
    return this.list().filter((n) => (n.source ?? 'builtin') === source);
  }

  /** 序列化全部节点定义（/api/nodes 与前端节点库共用） */
  toJSON(): NodeDefinition[] {
    return this.list();
  }

  has(type: string): boolean {
    return this.nodes.has(type);
  }
}

export const nodeRegistry = new NodeRegistry();
