import { describe, it, expect } from 'vitest';
import {
  validateSkillDefinition,
  resolveSkillInputs,
  inputsToJsonSchema,
  uiFormSchema,
} from '../skill-schema';
import { computeSkillQuality, estimateCost, buildImprovements } from '../skill-metrics';
import { checkRateLimit } from '../skill-resolver';
import { executeSkillWorkflow } from '../skill-runtime';
import { ExecutorRegistry } from '../../tinyflow/executors';
import { BaseExecutor } from '../../tinyflow/executors/BaseExecutor';
import type { FlowNode, FlowContext, SubFlowRunner, TinyflowData } from '../../tinyflow/types';

// 注册测试延时执行器：可被 signal 中止（用于超时测试）
class SkillDelayExecutor extends BaseExecutor {
  async execute(_node: FlowNode, _ctx: FlowContext, _sf?: SubFlowRunner, signal?: AbortSignal) {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const t = setTimeout(resolve, 5000);
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal?.reason); }, { once: true });
    });
    return { output: 'done' };
  }
}
ExecutorRegistry.register('xSkillDelay', SkillDelayExecutor as never);

function flow(): TinyflowData {
  return {
    nodes: [
      { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: { title: '开始', parameters: [{ id: 'p', name: 'query', refType: 'input' }] } as never },
      { id: 'code', type: 'codeNode', position: { x: 0, y: 0 }, data: { title: '处理', code: 'return "summary:" + (inputs.query || "");', parameters: [{ id: 'q', name: 'query', refType: 'input' }] } as never },
      { id: 'end', type: 'endNode', position: { x: 0, y: 0 }, data: { title: '结束', parameters: [{ id: 'o', name: 'final', refType: 'ref', ref: 'code.output' }] } as never },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'code' },
      { id: 'e2', source: 'code', target: 'end' },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  } as TinyflowData;
}

describe('Skill Schema', () => {
  it('validateSkillDefinition：合法定义通过', () => {
    const def = {
      name: 'AI News Summarizer',
      description: '总结新闻',
      inputs: { fields: [{ name: 'topic', type: 'string', required: true }] },
      outputs: { fields: [{ name: 'summary', type: 'string' }] },
      examples: [],
    };
    expect(validateSkillDefinition(def).valid).toBe(true);
  });

  it('validateSkillDefinition：缺 name / 非法类型拒绝', () => {
    expect(validateSkillDefinition({ description: 'x', inputs: { fields: [] }, outputs: { fields: [] } }).valid).toBe(false);
    expect(validateSkillDefinition({ name: 'x', description: 'y', inputs: { fields: [{ name: 'a', type: 'banana' }] }, outputs: { fields: [] } }).valid).toBe(false);
  });

  it('resolveSkillInputs：必填校验 + 类型规整', () => {
    const schema: { fields: Array<{ name: string; type: 'string' | 'number' | 'array'; required?: boolean }> } = {
      fields: [
        { name: 'topic', type: 'string', required: true },
        { name: 'count', type: 'number' },
        { name: 'tags', type: 'array' },
      ],
    };
    expect(resolveSkillInputs({}, schema).ok).toBe(false);
    const r = resolveSkillInputs({ topic: 'AI', count: '5', tags: '["a","b"]' }, schema);
    expect(r.ok).toBe(true);
    expect(r.resolved.count).toBe(5);
    expect(Array.isArray(r.resolved.tags)).toBe(true);
  });

  it('inputsToJsonSchema / uiFormSchema', () => {
    const schema: { fields: Array<{ name: string; type: 'string'; required?: boolean; label?: string }> } = {
      fields: [{ name: 'topic', type: 'string', required: true, label: '主题' }],
    };
    const js = inputsToJsonSchema(schema);
    expect((js.required as string[]).includes('topic')).toBe(true);
    expect(uiFormSchema(schema)[0].label).toBe('主题');
  });
});

describe('Skill Metrics（Quality）', () => {
  it('computeSkillQuality：综合分与风险', () => {
    const q = computeSkillQuality({
      totalRuns: 10,
      successRuns: 9,
      errorRuns: 1,
      durationsMs: [1000, 900, 800],
      tokenUsages: [1000, 2000],
      costs: [0.01, 0.02],
      testRuns: { passed: 8, total: 10 },
    });
    expect(q.successRate).toBe(90);
    expect(q.testPassRate).toBe(80);
    expect(q.qualityScore).toBeGreaterThan(0);
    expect(q.risk).toBeDefined();
  });

  it('estimateCost 随 token 单调递增', () => {
    expect(estimateCost(2000)).toBeGreaterThan(estimateCost(1000));
  });

  it('buildImprovements：高错误率给出建议', () => {
    const q = computeSkillQuality({ totalRuns: 10, successRuns: 5, errorRuns: 5, durationsMs: [100], tokenUsages: [100], costs: [0.01], testRuns: { passed: 0, total: 0 } });
    const items = buildImprovements(q);
    expect(items.some((x) => x.includes('错误率'))).toBe(true);
  });
});

describe('Skill Resolver（限流）', () => {
  it('checkRateLimit：超出上限返回 limited', () => {
    const now = 0;
    const r1 = checkRateLimit('k', 2, now);
    expect(r1.limited).toBe(false);
    const r2 = checkRateLimit('k', 2, now + 100);
    expect(r2.limited).toBe(false);
    const r3 = checkRateLimit('k', 2, now + 200);
    expect(r3.limited).toBe(true);
    // 窗口重置后可继续
    const r4 = checkRateLimit('k', 2, now + 60_100);
    expect(r4.limited).toBe(false);
  });
});

describe('Skill Runtime（复用 FlowEngine）', () => {
  it('正常执行 completed 并返回输出与耗时', async () => {
    const r = await executeSkillWorkflow(flow(), {
      skillId: 'sk1',
      inputs: { query: 'AI' },
    }, );
    expect(r.status).toBe('completed');
    expect(r.outputs?.final).toBe('summary:AI');
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
    expect(r.runId).toBeDefined();
  }, 20000);

  it('工作流报错 → failed', async () => {
    const bad = {
      nodes: [
        { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: { title: 's', parameters: [] } as never },
        { id: 'code', type: 'codeNode', position: { x: 0, y: 0 }, data: { title: 'boom', code: 'throw new Error("skill boom");' } as never },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'code' }],
      viewport: { x: 0, y: 0, zoom: 1 },
    } as TinyflowData;
    const r = await executeSkillWorkflow(bad, { skillId: 'sk2', inputs: {} });
    expect(r.status).toBe('failed');
    expect(r.error).toContain('skill boom');
  }, 20000);

  it('超时 → timeout', async () => {
    const slow = {
      nodes: [
        { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: { title: 's', parameters: [] } as never },
        { id: 'slow', type: 'xSkillDelay', position: { x: 0, y: 0 }, data: { title: 'slow' } as never },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'slow' }],
      viewport: { x: 0, y: 0, zoom: 1 },
    } as TinyflowData;
    const r = await executeSkillWorkflow(slow, { skillId: 'sk3', inputs: {}, timeoutMs: 50 });
    expect(r.status).toBe('timeout');
  }, 20000);
});
