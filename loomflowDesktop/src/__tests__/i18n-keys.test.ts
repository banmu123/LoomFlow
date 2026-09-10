/**
 * i18n 键完整性测试（Desktop）
 *
 * t() 在找不到 key 时会原样返回 key 字符串，而调用处常见的写法是
 * `t('x.y') || '默认值'` —— 由于 key 字符串是 truthy，默认值永远不会生效，
 * 界面上会直接显示 "x.y" 这样的原始 key。
 *
 * 这里扫描 desktop 源码里所有 t('...') 调用，校验它们在 zh / en 两份文案里
 * 都能解析到，避免新增/改名时静默漏翻译。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zh } from '@/messages/zh';
import { en } from '@/messages/en';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 递归收集 .ts/.tsx 文件（跳过测试目录本身） */
function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      out.push(...collectFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** 与 @/lib/i18n 的 resolveKey 保持一致的嵌套解析 */
function resolveKey(messages: unknown, key: string): string | undefined {
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

/** 收集源码中所有 t('a.b') / t("a.b") 的 key */
function collectKeys(): string[] {
  const keys = new Set<string>();
  for (const file of collectFiles(SRC_DIR)) {
    const content = readFileSync(file, 'utf8');
    const re = /\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) keys.add(m[1]);
  }
  return [...keys].sort();
}

describe('i18n keys used by desktop', () => {
  const keys = collectKeys();

  it('should find some keys in the source (sanity check)', () => {
    expect(keys.length).toBeGreaterThan(20);
  });

  it('every t() key should resolve in zh', () => {
    const missing = keys.filter((k) => resolveKey(zh, k) === undefined);
    expect(missing, `zh 缺失的 key:\n${missing.join('\n')}`).toEqual([]);
  });

  it('every t() key should resolve in en', () => {
    const missing = keys.filter((k) => resolveKey(en, k) === undefined);
    expect(missing, `en 缺失的 key:\n${missing.join('\n')}`).toEqual([]);
  });
});
