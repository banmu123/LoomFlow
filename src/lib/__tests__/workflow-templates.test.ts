import { describe, it, expect } from 'vitest';
import { WORKFLOW_TEMPLATES } from '../workflow-templates';

describe('工作流模板结构合法性', () => {
  it('至少 4 个模板', () => {
    expect(WORKFLOW_TEMPLATES.length).toBeGreaterThanOrEqual(4);
  });

  it('每个模板：节点结构合法', () => {
    for (const tpl of WORKFLOW_TEMPLATES) {
      const nodes = tpl.data.nodes;
      expect(nodes.length, `${tpl.id} 应有节点`).toBeGreaterThan(0);

      // 必须包含开始/结束节点
      const types = nodes.map((n) => n.type);
      expect(types, `${tpl.id} 缺开始节点`).toContain('startNode');
      expect(types, `${tpl.id} 缺结束节点`).toContain('endNode');
      expect(types, `${tpl.id} 缺 LLM 节点`).toContain('llmNode');

      // 节点 id 唯一
      const ids = nodes.map((n) => n.id);
      expect(new Set(ids).size, `${tpl.id} 节点 id 重复`).toBe(ids.length);

      // 节点必须有 position 和 data
      for (const n of nodes) {
        expect(n.position.x, `${tpl.id} ${n.id} 缺 x`).toBeTypeOf('number');
        expect(n.position.y, `${tpl.id} ${n.id} 缺 y`).toBeTypeOf('number');
        expect(n.data, `${tpl.id} ${n.id} 缺 data`).toBeTruthy();
      }
    }
  });

  it('每个模板：边引用存在的节点', () => {
    for (const tpl of WORKFLOW_TEMPLATES) {
      const nodeIds = new Set(tpl.data.nodes.map((n) => n.id));
      for (const e of tpl.data.edges) {
        expect(nodeIds.has(e.source), `${tpl.id} 边 ${e.id} 源节点不存在`).toBe(true);
        expect(nodeIds.has(e.target), `${tpl.id} 边 ${e.id} 目标节点不存在`).toBe(true);
      }
    }
  });

  it('每个模板：LLM 节点有模型与提示词配置', () => {
    for (const tpl of WORKFLOW_TEMPLATES) {
      const llmNode = tpl.data.nodes.find((n) => n.type === 'llmNode');
      expect(llmNode?.data.llmId, `${tpl.id} 缺 llmId`).toBeTruthy();
      expect(llmNode?.data.userPrompt, `${tpl.id} 缺 userPrompt`).toBeTruthy();
      // 参数引用必须指向存在的节点/参数
      const params = llmNode?.data.parameters as
        | Array<{ ref?: string }>
        | undefined;
      for (const p of params ?? []) {
        expect(p.ref, `${tpl.id} 参数缺 ref`).toBeTruthy();
        expect(String(p.ref).startsWith('node_start.'), `${tpl.id} ref 应引用开始节点`).toBe(true);
      }
    }
  });

  it('viewport 合法', () => {
    for (const tpl of WORKFLOW_TEMPLATES) {
      expect(tpl.data.viewport.x).toBeTypeOf('number');
      expect(tpl.data.viewport.y).toBeTypeOf('number');
      expect(tpl.data.viewport.zoom).toBeGreaterThan(0);
    }
  });
});
