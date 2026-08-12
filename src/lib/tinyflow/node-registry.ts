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

  has(type: string): boolean {
    return this.nodes.has(type);
  }
}

export const nodeRegistry = new NodeRegistry();
