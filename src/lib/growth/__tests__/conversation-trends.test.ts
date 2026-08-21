import { describe, it, expect } from 'vitest';
import { extractTopicsFromText } from '../conversation-trends';

describe('conversation-trends 对话趋势提取', () => {
  it('提取职业发展主题', () => {
    const topics = extractTopicsFromText('最近在考虑跳槽，面试了几家公司，不知道要不要换工作');
    const career = topics.find((t) => t.topic === '职业发展');
    expect(career).toBeDefined();
    expect(career!.count).toBeGreaterThan(0);
  });

  it('提取多个主题并排序', () => {
    const topics = extractTopicsFromText(
      '我想学 Python 编程，同时也在用 AI 做大模型相关的东西，最近有点焦虑，压力很大',
    );
    const names = topics.map((t) => t.topic);
    expect(names).toContain('编程技术');
    expect(names).toContain('AI 应用');
    expect(names).toContain('身心健康');
    // 按提及次数降序
    for (let i = 1; i < topics.length; i++) {
      expect(topics[i - 1].count).toBeGreaterThanOrEqual(topics[i].count);
    }
  });

  it('英文关键词也能匹配', () => {
    const topics = extractTopicsFromText('I have a bug in my python code and need help with the API');
    const names = topics.map((t) => t.topic);
    expect(names).toContain('编程技术');
  });

  it('空文本返回空数组', () => {
    expect(extractTopicsFromText('')).toEqual([]);
    expect(extractTopicsFromText('    ')).toEqual([]);
  });

  it('无关键词时返回空数组', () => {
    expect(extractTopicsFromText('今天天气不错')).toEqual([]);
  });

  it('重复提及会累计计数', () => {
    const topics = extractTopicsFromText('工作工作工作，每天都在忙工作');
    const career = topics.find((t) => t.topic === '职业发展');
    expect(career!.count).toBeGreaterThanOrEqual(3);
  });
});
