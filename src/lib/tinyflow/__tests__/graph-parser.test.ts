import { describe, it, expect } from 'vitest';
import { GraphParser } from '../engine/GraphParser';
import type { TinyflowData } from '../types';

function makeFlow(
  nodes: Array<{ id: string; type: string }>,
  edges: Array<{ id: string; source: string; target: string }>,
): TinyflowData {
  return { nodes, edges } as TinyflowData;
}

describe('GraphParser', () => {
  it('解析节点与边', () => {
    const parser = new GraphParser(
      makeFlow(
        [
          { id: 'start', type: 'startNode' },
          { id: 'llm', type: 'llmNode' },
          { id: 'end', type: 'endNode' },
        ],
        [
          { id: 'e1', source: 'start', target: 'llm' },
          { id: 'e2', source: 'llm', target: 'end' },
        ],
      ),
    );
    expect(parser.getAllNodes().length).toBe(3);
  });

  it('Kahn 拓扑排序：线性依赖按序执行', () => {
    const parser = new GraphParser(
      makeFlow(
        [
          { id: 'start', type: 'startNode' },
          { id: 'b', type: 'llmNode' },
          { id: 'a', type: 'llmNode' },
          { id: 'end', type: 'endNode' },
        ],
        [
          { id: 'e1', source: 'start', target: 'a' },
          { id: 'e2', source: 'a', target: 'b' },
          { id: 'e3', source: 'b', target: 'end' },
        ],
      ),
    );
    const order = parser.topologicalSort().map((n) => n.id);
    // a 必须在 b 之前，b 必须在 end 之前
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('end'));
    expect(order[0]).toBe('start');
  });

  it('检测循环依赖', () => {
    const parser = new GraphParser(
      makeFlow(
        [
          { id: 'a', type: 'llmNode' },
          { id: 'b', type: 'llmNode' },
        ],
        [
          { id: 'e1', source: 'a', target: 'b' },
          { id: 'e2', source: 'b', target: 'a' },
        ],
      ),
    );
    expect(() => parser.topologicalSort()).toThrow();
  });

  it('获取节点的后继节点', () => {
    const parser = new GraphParser(
      makeFlow(
        [
          { id: 'start', type: 'startNode' },
          { id: 'a', type: 'llmNode' },
          { id: 'b', type: 'llmNode' },
        ],
        [
          { id: 'e1', source: 'start', target: 'a' },
          { id: 'e2', source: 'start', target: 'b' },
        ],
      ),
    );
    const children = parser.getOutgoingEdges('start').sort();
    expect(children).toEqual(['a', 'b']);
  });
});
