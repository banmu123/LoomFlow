/**
 * 全局 toast 容器单例契约测试（Desktop）
 *
 * 背景：`main.tsx` 与 `App.tsx` 曾经各挂载了一个 `<Toaster />`
 * （一个 top-right、一个 top-center）。sonner 的 toast store 是模块级单例，
 * 每个 `<Toaster />` 都会独立订阅并渲染同一条消息 —— 结果是一次操作
 * （如切换中英文）会同时弹出两个提示，看起来像「重复触发」的业务 bug。
 *
 * 桌面端测试环境为 node（无 DOM），因此这里对源码做结构性断言，
 * 锁住「全局只允许一个 Toaster」这一契约，防止回归。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 去掉注释，避免文档里提到的示例写法被误判为真实挂载点 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 递归收集 src 下的所有 .ts/.tsx 文件（跳过 __tests__ 自身） */
function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === '__tests__' ? [] : collectSourceFiles(full);
    }
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

/** 找出所有真正挂载了 <Toaster /> 的文件 */
function filesMountingToaster(): string[] {
  return collectSourceFiles(SRC_DIR)
    .filter((file) => /<Toaster\b/.test(stripComments(readFileSync(file, 'utf8'))))
    .map((file) => relative(SRC_DIR, file));
}

describe('全局 Toaster 单例契约', () => {
  it('整个 src 目录有且只有一个 <Toaster /> 挂载点', () => {
    const mounting = filesMountingToaster();
    expect(
      mounting,
      `检测到 ${mounting.length} 个 <Toaster /> 挂载点：${mounting.join(', ')}；` +
        'sonner 的 toast store 是单例，多挂载会导致同一条提示重复弹出',
    ).toEqual(['App.tsx']);
  });

  it('入口 main.tsx 不得再挂载 Toaster（避免与 App 内重复）', () => {
    const entry = stripComments(readFileSync(join(SRC_DIR, 'main.tsx'), 'utf8'));
    expect(/<Toaster\b/.test(entry)).toBe(false);
  });

  it('唯一的 Toaster 应复用 theme 感知的共享封装', () => {
    const app = readFileSync(join(SRC_DIR, 'App.tsx'), 'utf8');
    // 直接从 'sonner' 引入的原生 Toaster 不跟随 next-themes，明暗切换会不协调
    expect(app).toContain("from '@/components/ui/sonner'");
  });

  it('语言切换提示必须用目标语言翻译（避免切成英文却弹中文）', () => {
    const settings = readFileSync(join(SRC_DIR, 'pages', 'SettingsPage.tsx'), 'utf8');
    expect(settings).toContain("translate(value, 'settings.languageSwitched'");
  });
});
