import { describe, it, expect } from 'vitest';
import { buildSearchTerms } from '../executors/KnowledgeExecutor';

describe('buildSearchTerms 知识库检索拆词', () => {
  it('中文长句提取 4 字滑动窗口', () => {
    const terms = buildSearchTerms('这个开发流程有没有什么问题');
    // 长句拆出包含"开发流/发流程"的窗口，能命中文档中的连续片段
    expect(terms.some((t) => t.includes('开发流'))).toBe(true);
    expect(terms.some((t) => t.includes('发流程'))).toBe(true);
  });

  it('过滤纯停用词窗口（"这个开"等）', () => {
    const terms = buildSearchTerms('这个开发流程');
    // "这个开" 含停用词"这个"被过滤
    expect(terms.includes('这个开')).toBe(false);
    expect(terms.some((t) => t.includes('开发流'))).toBe(true);
  });

  it('英文按空格拆词', () => {
    const terms = buildSearchTerms('what is system awareness');
    expect(terms).toContain('system');
    expect(terms).toContain('awareness');
  });

  it('短词（单字）被过滤', () => {
    const terms = buildSearchTerms('好 的 流程');
    expect(terms.some((t) => t.length < 2)).toBe(false);
    expect(terms.some((t) => t.includes('流程'))).toBe(true);
  });

  it('重复窗口去重', () => {
    const terms = buildSearchTerms('开发流程开发流程');
    const unique = new Set(terms);
    expect(terms.length).toBe(unique.size);
  });

  it('最多 8 个词（PostgREST or 子句限制）', () => {
    const terms = buildSearchTerms('一二三四五六七八九十十一十二十三');
    expect(terms.length).toBeLessThanOrEqual(8);
  });

  it('空输入/纯标点返回空数组', () => {
    expect(buildSearchTerms('')).toEqual([]);
    expect(buildSearchTerms('？？？！！！')).toEqual([]);
  });

  it('整段不足 4 字时直接使用', () => {
    const terms = buildSearchTerms('测试');
    expect(terms).toContain('测试');
  });
});
