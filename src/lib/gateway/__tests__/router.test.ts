import { describe, it, expect } from 'vitest';
import type { ModelDefinition } from '@/lib/ai';
import { planCandidates } from '../router';

const models: ModelDefinition[] = [
  { id: 'cheap', provider: 'deepseek', capabilities: ['text'] },
  { id: 'expensive', provider: 'openai', capabilities: ['text', 'vision'] },
  { id: 'local', provider: 'ollama', capabilities: ['text'] },
];

const prices = {
  cheap: { inputPer1M: 0.1, outputPer1M: 0.2, currency: 'USD' },
  expensive: { inputPer1M: 5, outputPer1M: 15, currency: 'USD' },
};

describe('模型路由', () => {
  it('显式指定优先，其次是备用模型', () => {
    const plan = planCandidates({
      models,
      explicitModelId: 'expensive',
      fallbackModelIds: ['cheap'],
    });

    expect(plan.map((m) => m.id)).toEqual(['expensive', 'cheap']);
    expect(plan[0].origin).toBe('explicit');
    expect(plan[1].origin).toBe('fallback');
  });

  it('按任务能力筛选（vision 不能落到纯文本模型）', () => {
    const plan = planCandidates({ models, taskType: 'vision' });
    expect(plan.map((m) => m.id)).toEqual(['expensive']);
  });

  it('未指定模型时按成本偏好排序，未知价格排最后', () => {
    const plan = planCandidates({ models, prefer: 'cost', prices });
    expect(plan.map((m) => m.id)).toEqual(['cheap', 'expensive', 'local']);
  });

  it('成本偏好下未配置价格的模型不参与优先选择', () => {
    const plan = planCandidates({ models: models.slice(0, 2), prefer: 'cost', prices });
    expect(plan[0].id).toBe('cheap');
  });

  it('去重且限制候选数量（防请求放大）', () => {
    const plan = planCandidates({
      models,
      explicitModelId: 'cheap',
      fallbackModelIds: ['cheap', 'cheap', 'local', 'expensive'],
      maxCandidates: 2,
    });
    expect(plan.map((m) => m.id)).toEqual(['cheap', 'local']);
  });

  it('能力不满足的显式模型被跳过', () => {
    const plan = planCandidates({
      models,
      explicitModelId: 'cheap',
      requireCapabilities: ['vision'],
    });
    expect(plan).toEqual([]);
  });

  it('排除的模型不会出现', () => {
    const plan = planCandidates({ models, exclude: new Set(['cheap']) });
    expect(plan.map((m) => m.id)).toEqual(['expensive', 'local']);
  });
});
