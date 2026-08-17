import { describe, it, expect } from 'vitest';
import { extractWorkflowJson } from '../workflow-extract';

describe('extractWorkflowJson', () => {
  it('提取 ```json 代码块中的工作流', () => {
    const content = '给你设计了一个工作流：\n```json\n{"nodes":[{"id":"n1"}],"edges":[{"id":"e1"}]}\n```\n祝使用愉快';
    const result = extractWorkflowJson(content);
    expect(result).not.toBeNull();
    expect(result?.nodes).toHaveLength(1);
    expect(result?.edges).toHaveLength(1);
  });

  it('提取无 language 标记的 ``` 代码块', () => {
    const content = '```\n{"nodes":[],"edges":[]}\n```';
    const result = extractWorkflowJson(content);
    expect(result).not.toBeNull();
    expect(result?.nodes).toEqual([]);
  });

  it('普通 JSON 代码块（非工作流结构）返回 null', () => {
    const content = '```json\n{"name":"张三","age":30}\n```';
    expect(extractWorkflowJson(content)).toBeNull();
  });

  it('缺少 edges 或 nodes 返回 null', () => {
    expect(extractWorkflowJson('```json\n{"nodes":[]}\n```')).toBeNull();
    expect(extractWorkflowJson('```json\n{"edges":[]}\n```')).toBeNull();
  });

  it('非法 JSON 返回 null', () => {
    expect(extractWorkflowJson('```json\n{not valid json}\n```')).toBeNull();
  });

  it('无代码块返回 null', () => {
    expect(extractWorkflowJson('这是一段普通文本，没有代码块')).toBeNull();
  });

  it('空内容返回 null', () => {
    expect(extractWorkflowJson('')).toBeNull();
  });

  it('nodes/edges 为对象（非数组）返回 null', () => {
    const content = '```json\n{"nodes":{},"edges":[]}\n```';
    expect(extractWorkflowJson(content)).toBeNull();
  });
});
