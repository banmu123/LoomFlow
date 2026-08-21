import { describe, it, expect } from 'vitest';
import { behaviorInsightToText, NODE_TYPE_LABELS } from '../behavior-insights';
import type { BehaviorInsight } from '../behavior-insights';

describe('behavior-insights 行为洞察', () => {
  const base: BehaviorInsight = {
    recentWorkflows: 0,
    totalWorkflows: 0,
    publishedCount: 0,
    runCount: 0,
    successRate: 0,
    nodeTypePrefs: [],
    recentTitles: [],
    runTrend: 'flat',
  };

  it('空行为返回空文本', () => {
    expect(behaviorInsightToText(base)).toBe('');
  });

  it('生成工作流摘要（含标题）', () => {
    const text = behaviorInsightToText({
      ...base,
      recentWorkflows: 3,
      recentTitles: ['数据清洗', '周报生成', '翻译助手'],
    });
    expect(text).toContain('近 7 天创建/保存了 3 个工作流');
    expect(text).toContain('数据清洗');
    expect(text).toContain('周报生成');
  });

  it('生成发布和执行摘要', () => {
    const text = behaviorInsightToText({
      ...base,
      totalWorkflows: 5,
      publishedCount: 2,
      runCount: 10,
      successRate: 0.8,
    });
    expect(text).toContain('累计 5 个工作流');
    expect(text).toContain('2 个已发布为 API');
    expect(text).toContain('共执行 10 次');
    expect(text).toContain('成功率 80%');
  });

  it('执行趋势上升', () => {
    const text = behaviorInsightToText({ ...base, runCount: 5, successRate: 0.5, runTrend: 'up' });
    expect(text).toContain('最近越来越频繁');
  });

  it('节点类型偏好（含中文标签映射）', () => {
    const text = behaviorInsightToText({
      ...base,
      nodeTypePrefs: [
        { type: 'llmNode', count: 5 },
        { type: 'httpNode', count: 2 },
      ],
    });
    expect(text).toContain('常用节点');
    expect(text).toContain(NODE_TYPE_LABELS.llmNode);
    expect(text).toContain(NODE_TYPE_LABELS.httpNode);
    expect(text).toContain('5');
  });

  it('完整摘要组合', () => {
    const text = behaviorInsightToText({
      recentWorkflows: 2,
      totalWorkflows: 8,
      publishedCount: 1,
      runCount: 20,
      successRate: 0.9,
      nodeTypePrefs: [{ type: 'llmNode', count: 3 }],
      recentTitles: ['自动回复'],
      runTrend: 'up',
    });
    expect(text).toContain('近 7 天创建/保存了 2 个工作流');
    expect(text).toContain('累计 8 个工作流');
    expect(text).toContain('成功率 90%');
    expect(text).toContain('AI 对话');
  });
});
