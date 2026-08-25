import type { TinyflowData, FlowNode } from '../types';

export class GraphParser {
  private nodes: Map<string, FlowNode>;
  private adjacency: Map<string, string[]>;
  private reverseAdj: Map<string, string[]>;

  constructor(data: TinyflowData) {
    this.nodes = new Map(data.nodes.map((n) => [n.id, n]));
    this.adjacency = new Map();
    this.reverseAdj = new Map();

    for (const node of data.nodes) {
      this.adjacency.set(node.id, []);
      this.reverseAdj.set(node.id, []);
    }

    for (const edge of data.edges) {
      const targets = this.adjacency.get(edge.source);
      if (targets) targets.push(edge.target);
      const sources = this.reverseAdj.get(edge.target);
      if (sources) sources.push(edge.source);
    }
  }

  getStartNode(): FlowNode {
    const start = [...this.nodes.values()].find((n) => n.type === 'startNode');
    if (!start) throw new Error('流程缺少开始节点');
    return start;
  }

  getNode(id: string): FlowNode | undefined {
    return this.nodes.get(id);
  }

  getAllNodes(): FlowNode[] {
    return [...this.nodes.values()];
  }

  getOutgoingEdges(nodeId: string): string[] {
    return this.adjacency.get(nodeId) || [];
  }

  getIncomingNodes(nodeId: string): FlowNode[] {
    return (this.reverseAdj.get(nodeId) || [])
      .map((id) => this.nodes.get(id)!)
      .filter(Boolean);
  }

  /** Kahn 算法拓扑排序 */
  topologicalSort(): FlowNode[] {
    const inDegree = new Map<string, number>();
    for (const node of this.nodes.values()) {
      inDegree.set(node.id, 0);
    }
    for (const [, targets] of this.adjacency) {
      for (const target of targets) {
        inDegree.set(target, (inDegree.get(target) || 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }

    const sorted: FlowNode[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const node = this.nodes.get(current);
      if (node) sorted.push(node);

      for (const target of this.adjacency.get(current) || []) {
        const newDegree = (inDegree.get(target) || 0) - 1;
        inDegree.set(target, newDegree);
        if (newDegree === 0) queue.push(target);
      }
    }

    if (sorted.length !== this.nodes.size) {
      throw new Error('流程图中存在循环依赖');
    }
    return sorted;
  }

  /** 获取 LoopNode 的子节点 */
  getChildren(loopNodeId: string): FlowNode[] {
    return [...this.nodes.values()].filter((n) => n.parentId === loopNodeId);
  }

  /** 反向邻接：节点的前驱节点集合 */
  getIncomingIds(nodeId: string): string[] {
    return this.reverseAdj.get(nodeId) || [];
  }

  /**
   * 计算每个节点从其直接前驱可直接就绪的集合。
   * 返回 Map<nodeId, 可直接就绪的前驱数>（不考虑该前驱是否真的会执行）。
   */
  getDependencyCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const node of this.nodes.values()) {
      if (node.parentId) continue; // loop 子节点由 LoopExecutor 内部调度
      counts.set(node.id, (this.reverseAdj.get(node.id) || []).length);
    }
    return counts;
  }

  /** 图广度可达节点集合（用于检查 start 是否可到达某节点） */
  reachableFrom(startId: string): Set<string> {
    const visited = new Set<string>();
    const queue = [startId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      for (const target of this.adjacency.get(id) || []) queue.push(target);
    }
    return visited;
  }

  /** 节点 id 对应的 FlowNode（别名便利） */
  getNodeId(id: string): string | undefined {
    return this.nodes.get(id)?.id;
  }
}
