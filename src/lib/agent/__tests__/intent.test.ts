import { describe, it, expect } from 'vitest';
import { detectIntent, detectIntentFromMessages } from '../intent';

describe('detectIntent 意图分流', () => {
  it('查询类：工作流列表', () => {
    expect(detectIntent('我的工作流有哪些？')).toBe('query');
  });

  it('查询类：排错', () => {
    expect(detectIntent('我的工作流为什么执行失败了')).toBe('query');
    expect(detectIntent('帮我查一下调用日志')).toBe('query');
  });

  it('查询类：知识库相关（含创建知识库——需工具模式）', () => {
    expect(detectIntent('我的知识库里有什么')).toBe('query');
    expect(detectIntent('帮我创建一个知识库，叫测试')).toBe('query');
    expect(detectIntent('根据我的知识库回答')).toBe('query');
  });

  it('查询类：管理数据（统计/审计/用户/模型）', () => {
    expect(detectIntent('现在平台的用量统计怎么样')).toBe('query');
    expect(detectIntent('审计日志有什么')).toBe('query');
    expect(detectIntent('有哪些用户')).toBe('query');
    expect(detectIntent('帮我配置一个模型')).toBe('query');
  });

  it('查询类：自定义节点（含创建——需工具模式）', () => {
    expect(detectIntent('帮我创建一个自定义节点')).toBe('query');
    expect(detectIntent('帮我创建一个翻译节点')).toBe('query');
    expect(detectIntent('帮我封装一个可复用节点')).toBe('query');
    expect(detectIntent('自定义节点库里有什么')).toBe('query');
  });

  it('生成类：创建工作流', () => {
    expect(detectIntent('帮我创建一个工作流')).toBe('generate');
    expect(detectIntent('设计一个文案生成流程')).toBe('generate');
    expect(detectIntent('帮我实现一个翻译功能')).toBe('generate');
  });

  it('闲聊类', () => {
    expect(detectIntent('你好')).toBe('chat');
    expect(detectIntent('今天天气怎么样')).toBe('chat');
    expect(detectIntent('你能做什么')).toBe('chat');
  });

  it('优先级：query > generate（"创建知识库"含生成词但属系统操作）', () => {
    expect(detectIntent('帮我创建一个知识库检索工作流')).toBe('query');
  });

  it('空输入回退 chat', () => {
    expect(detectIntent('')).toBe('chat');
    expect(detectIntent('   ')).toBe('chat');
  });
});

describe('detectIntentFromMessages 多轮历史', () => {
  it('取最后一条用户消息判断', () => {
    expect(
      detectIntentFromMessages([
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好！有什么可以帮你？' },
        { role: 'user', content: '我的工作流有哪些' },
      ]),
    ).toBe('query');
  });

  it('历史中即使有查询词，也以最后一条为准', () => {
    expect(
      detectIntentFromMessages([
        { role: 'user', content: '我的工作流有哪些' },
        { role: 'assistant', content: '你有 3 个工作流' },
        { role: 'user', content: '帮我创建一个工作流' },
      ]),
    ).toBe('generate');
  });

  it('无用户消息回退 chat', () => {
    expect(detectIntentFromMessages([{ role: 'assistant', content: '你好' }])).toBe('chat');
    expect(detectIntentFromMessages([])).toBe('chat');
  });
});
