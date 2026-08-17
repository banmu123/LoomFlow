import { describe, it, expect } from 'vitest';
import {
  getConfigDefaults,
  validateConfig,
  mergeConfig,
  resolveConfigOptions,
} from '../node-config';
import type { NodeConfigField } from '../node-definition';
import { nodeRegistry } from '../node-registry';
import '../nodes/builtin'; // 注册内置节点（version 断言用）

const SCHEMA: NodeConfigField[] = [
  { name: 'url', label: 'URL', type: 'string', required: true },
  { name: 'timeout', label: '超时', type: 'number', default: 10, min: 1, max: 60 },
  { name: 'method', label: '方法', type: 'select', default: 'GET', options: [{ value: 'GET', label: 'GET' }] },
  { name: 'debug', label: '调试', type: 'boolean', default: false },
  { name: 'prompt', label: '提示词', type: 'textarea' },
];

describe('node-config：configSchema 默认值 / 校验 / 合并', () => {
  it('getConfigDefaults 只取有默认值的字段', () => {
    const defaults = getConfigDefaults(SCHEMA);
    expect(defaults.timeout).toBe(10);
    expect(defaults.method).toBe('GET');
    expect(defaults.debug).toBe(false);
    expect(defaults.url).toBeUndefined(); // 无默认值
  });

  it('validateConfig：必填校验', () => {
    const errors = validateConfig(SCHEMA, { timeout: 10 });
    expect(errors.some((e) => e.includes('URL'))).toBe(true);
  });

  it('validateConfig：number 范围校验（timeout 必须为正数）', () => {
    expect(validateConfig(SCHEMA, { url: 'x', timeout: 0 })).toContain('超时 不能小于 1');
    expect(validateConfig(SCHEMA, { url: 'x', timeout: -5 })).toContain('超时 不能小于 1');
    expect(validateConfig(SCHEMA, { url: 'x', timeout: 61 })).toContain('超时 不能大于 60');
    expect(validateConfig(SCHEMA, { url: 'x', timeout: 'abc' })).toContain('超时 必须是数字');
  });

  it('validateConfig：select 选项校验', () => {
    expect(validateConfig(SCHEMA, { url: 'x', method: 'DELETE' })).toContain('方法 选项不合法');
  });

  it('validateConfig：合法配置无错误', () => {
    const errors = validateConfig(SCHEMA, { url: 'https://x', timeout: 15, method: 'GET' });
    expect(errors).toHaveLength(0);
  });

  it('mergeConfig：只合并 schema 声明字段，保留未声明字段', () => {
    const merged = mergeConfig({ title: '节点', url: 'old' }, SCHEMA, { url: 'new', timeout: 20, extra: 'ignored' });
    expect(merged.url).toBe('new');
    expect(merged.timeout).toBe(20);
    expect(merged.title).toBe('节点'); // 未声明字段保留
    expect(merged.extra).toBeUndefined(); // 未声明字段不写入
  });
});

describe('node-config：动态选项 resolve（LLM 模型列表）', () => {
  it('resolveConfigOptions 将 optionsProvider 解析为静态 options', async () => {
    const schema: NodeConfigField[] = [
      { name: 'model', label: '模型', type: 'select', optionsProvider: async () => [{ value: 'm1', label: '模型一' }] },
      { name: 'title', label: '标题', type: 'string' },
    ];
    const resolved = await resolveConfigOptions(schema);
    expect(resolved[0].options).toEqual([{ value: 'm1', label: '模型一' }]);
    expect(resolved[0].optionsProvider).toBeUndefined(); // 函数不可 JSON 序列化，必须移除
    expect(resolved[1].optionsProvider).toBeUndefined(); // 非 select 字段不受影响
  });

  it('resolveConfigOptions：provider 抛错时回退空选项', async () => {
    const schema: NodeConfigField[] = [
      { name: 'model', label: '模型', type: 'select', optionsProvider: async () => { throw new Error('boom'); } },
    ];
    const resolved = await resolveConfigOptions(schema);
    expect(resolved[0].options).toBeUndefined();
    expect(resolved[0].optionsProvider).toBeUndefined();
  });
});

describe('node-definition：version / serializer 接口', () => {
  it('内置节点有默认 version（缺失时按 1）', () => {
    // 通过 /api/nodes 的映射逻辑验证：version ?? 1
    expect(nodeRegistry.get('llmNode')?.version ?? 1).toBe(1);
  });
});
