import { describe, it, expect } from 'vitest';
import { normalizeSkillDefinition, validateSkillDefinition } from '../skill-schema';
import { validateWorkflow } from '../../tinyflow/schema';

/**
 * 回归：nl-skill「一直反馈校验失败」
 * AI 按 /api/nl-skill 提示词生成的输出存在常见格式偏差，
 * normalizeSkillDefinition 需宽容归一后让校验通过。
 */
describe('nl-skill：AI 输出偏差 → normalize → 校验', () => {
  it('偏差1：字段 type 用了别名（text/int/bool/list 等）→ 归一后通过', () => {
    const def = {
      name: 'AI News Summarizer',
      description: '总结新闻',
      inputs: { fields: [{ name: 'topic', type: 'text', required: true }, { name: 'count', type: 'int' }] },
      outputs: { fields: [{ name: 'summary', type: 'text' }, { name: 'ok', type: 'bool' }] },
      examples: [],
    };
    expect(validateSkillDefinition(def).valid).toBe(false);
    const r = validateSkillDefinition(normalizeSkillDefinition(def));
    expect(r.valid).toBe(true);
  });

  it('偏差2：inputs/outputs 直接是数组 → 包装后通过', () => {
    const def = {
      name: 'AI News Summarizer',
      description: '总结新闻',
      inputs: [{ name: 'topic', type: 'string' }],
      outputs: [{ name: 'summary', type: 'string' }],
    };
    expect(validateSkillDefinition(def).valid).toBe(false);
    const r = validateSkillDefinition(normalizeSkillDefinition(def));
    expect(r.valid).toBe(true);
  });

  it('偏差3：缺 schemaVersion → 补 1；合法结构保持幂等', () => {
    const def = {
      name: 'x',
      description: 'y',
      inputs: { fields: [{ name: 'a', type: 'string' }] },
      outputs: { fields: [] },
      examples: [],
    };
    const n = normalizeSkillDefinition(def) as Record<string, unknown>;
    expect(n.schemaVersion).toBe(1);
    // 合法输入经 normalize 语义不变
    expect(validateSkillDefinition(normalizeSkillDefinition(def)).valid).toBe(true);
  });

  it('偏差4：类型实在非法（banana）→ 仍应拒绝（不掩盖真错误）', () => {
    const def = {
      name: 'x',
      description: 'y',
      inputs: { fields: [{ name: 'a', type: 'banana' }] },
      outputs: { fields: [] },
    };
    const r = validateSkillDefinition(normalizeSkillDefinition(def));
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toContain('banana');
  });

  it('工作流：完全合规的输出应通过（含 loop 子节点 parentId）', () => {
    const wf = {
      nodes: [
        { id: 'node_start', type: 'startNode', position: { x: 0, y: 0 }, data: { title: '开始', parameters: [{ id: 'p1', name: 'items', dataType: 'String', refType: 'input' }] } },
        { id: 'node_loop', type: 'loopNode', position: { x: 100, y: 0 }, data: { title: '循环' } },
        { id: 'node_sub', type: 'llmNode', parentId: 'node_loop', position: { x: 120, y: 20 }, data: { title: '子处理' } },
        { id: 'node_end', type: 'endNode', position: { x: 200, y: 0 }, data: { title: '结束', outputDefs: [{ id: 'o1', name: 'result', refType: 'ref', ref: 'node_loop.output' }] } },
      ],
      edges: [
        { id: 'e1', source: 'node_start', target: 'node_loop' },
        { id: 'e2', source: 'node_loop', target: 'node_end' },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    expect(validateWorkflow(wf).valid).toBe(true);
  });
});
