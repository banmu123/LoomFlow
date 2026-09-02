import { describe, it, expect } from 'vitest';
import { RECOMMENDATIONS } from '../chat-recommendations';
import { zh } from '@/messages/zh';
import { en } from '@/messages/en';

// 与 i18n 运行时（src/lib/i18n.tsx resolveKey）一致的嵌套 key 解析
function resolveKey(messages: Record<string, unknown>, key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === 'string' ? node : undefined;
}

// 新建对话欢迎页的模板推荐清单：key 失效会静默渲染出原始 key 字符串
describe('chat-recommendations 模板推荐', () => {
  it('key 无重复', () => {
    expect(new Set(RECOMMENDATIONS).size).toBe(RECOMMENDATIONS.length);
  });

  it('每个 key 在中英文字典中均存在且非空', () => {
    expect(RECOMMENDATIONS.length).toBeGreaterThan(0);
    for (const key of RECOMMENDATIONS) {
      const zhText = resolveKey(zh as unknown as Record<string, unknown>, key);
      expect(zhText, `中文字典缺失: ${key}`).toBeDefined();
      expect(zhText!.trim().length, `中文翻译为空: ${key}`).toBeGreaterThan(0);

      const enText = resolveKey(en as unknown as Record<string, unknown>, key);
      expect(enText, `英文字典缺失: ${key}`).toBeDefined();
      expect(enText!.trim().length, `英文翻译为空: ${key}`).toBeGreaterThan(0);
    }
  });
});
