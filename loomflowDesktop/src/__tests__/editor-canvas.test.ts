/**
 * 画布挂载与初始化契约测试（Desktop）
 *
 * 背景：EditorPage 曾经在 `loading` 为 true 时提前 `return <spinner/>`，导致
 * `<div ref={containerRef}>` 在首次渲染时尚未挂载，而初始化 Tinyflow 的 effect
 * 依赖为 `[]` —— `containerRef.current` 为空时直接 return 后再也不会重跑。
 * 结果是画布区域永远空白，且控制台没有任何报错（问题极难发现）。
 *
 * 桌面端测试环境为 node（无 DOM），因此这里对源码做结构性断言，
 * 锁住「画布容器必须无条件挂载」这一契约，防止回归。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const editorSource = readFileSync(join(SRC_DIR, 'pages', 'EditorPage.tsx'), 'utf8');

describe('EditorPage 画布初始化契约', () => {
  it('画布容器必须无条件渲染（ref 绑定存在）', () => {
    expect(editorSource).toContain('ref={containerRef}');
  });

  it('不得在 loading 状态下提前 return 整个组件（否则容器永不挂载）', () => {
    // 匹配 `if (loading) return ...` / `if (loading) { return ... }`
    const earlyReturn = /if\s*\(\s*loading\s*\)\s*(\{\s*)?return\b/.test(editorSource);
    expect(earlyReturn, '检测到 loading 提前 return：画布容器不会挂载，初始化 effect 将空跑').toBe(false);
  });

  it('关键初始化时序依赖必须是空依赖数组（只初始化一次）', () => {
    // 初始化 effect 以 `}, []);` 结尾；若改为依赖 loading，会在 loading 翻转时销毁重建
    const initEffect = editorSource.slice(editorSource.indexOf('// ===== Init Tinyflow ====='));
    const end = initEffect.indexOf('}, []);');
    expect(end, '未找到初始化 effect 的空依赖数组结尾').toBeGreaterThan(0);
  });

  it('传入 loomflow-ui 的构造参数应包含画布能力配置', () => {
    // 允许 `provider,` 简写与 `provider: value` 两种写法
    const requiredOptions: Array<[label: string, re: RegExp]> = [
      ['element', /element\s*:/],
      ['defaultTheme', /defaultTheme\s*:/],
      ['data', /\bdata\s*[:,]/],
      ['provider', /\bprovider\s*[:,]/],
      ['customNodes', /customNodes\s*:/],
      ['onDataChange', /onDataChange\s*:/],
    ];
    for (const [label, re] of requiredOptions) {
      expect(re.test(editorSource), `Tinyflow 构造参数缺少 ${label}`).toBe(true);
    }
  });

  it('应接入画布内置文本的本地化 hook', () => {
    expect(editorSource).toContain('useTinyflowLocale(containerRef)');
  });

  it('主题应跟随 next-themes，而不是硬编码 light', () => {
    expect(editorSource).toContain('useTheme()');
    expect(editorSource).not.toMatch(/defaultTheme:\s*'light'/);
  });

  it('应注册 tinyflow 未内置的节点类型为 customNodes', () => {
    expect(editorSource).toContain('nodeRegistry.list()');
    expect(editorSource).toContain('TINYFLOW_BUILTIN_TYPES');
  });
});
