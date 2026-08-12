import { describe, it, expect } from 'vitest';
import { zh } from '../zh';
import { en } from '../en';

// 递归提取对象的所有 key 路径
function collectKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') {
      keys.push(...collectKeys(value as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

describe('i18n 字典一致性', () => {
  it('英文与中文字典 key 完全一致', () => {
    const zhKeys = collectKeys(zh).sort();
    const enKeys = collectKeys(en).sort();
    expect(enKeys).toEqual(zhKeys);
  });

  it('所有翻译值非空', () => {
    const assertNonEmpty = (obj: Record<string, unknown>, path = '') => {
      for (const [key, value] of Object.entries(obj)) {
        const p = path ? `${path}.${key}` : key;
        if (typeof value === 'string') {
          expect(value.trim().length, `空翻译: ${p}`).toBeGreaterThan(0);
        } else if (value && typeof value === 'object') {
          assertNonEmpty(value as Record<string, unknown>, p);
        }
      }
    };
    assertNonEmpty(zh);
    assertNonEmpty(en);
  });
});
