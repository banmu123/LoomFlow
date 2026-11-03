import { describe, it, expect } from 'vitest';
import { assertSandboxConfigured, resolveSandboxConfig } from '../config';

describe('代码沙箱配置', () => {
  it('默认使用容器沙箱（不允许默认回退到 node:vm）', () => {
    expect(resolveSandboxConfig({}).mode).toBe('container');
  });

  it('显式 vm 模式', () => {
    expect(resolveSandboxConfig({ LOOMFLOW_CODE_SANDBOX: 'VM' }).mode).toBe('vm');
  });

  it('非法取值直接报错', () => {
    expect(() => resolveSandboxConfig({ LOOMFLOW_CODE_SANDBOX: 'nsjail' })).toThrow(
      /LOOMFLOW_CODE_SANDBOX/,
    );
  });

  it('去掉 URL 末尾斜杠', () => {
    const config = resolveSandboxConfig({
      LOOMFLOW_CODE_SANDBOX: 'container',
      SANDBOX_RUNNER_URL: 'http://sandbox:8090///',
      SANDBOX_RUNNER_TOKEN: 't',
    });
    expect(config.url).toBe('http://sandbox:8090');
  });

  it('容器模式缺少 Runner 地址时失败关闭', () => {
    expect(() =>
      assertSandboxConfigured(resolveSandboxConfig({ SANDBOX_RUNNER_TOKEN: 't' })),
    ).toThrow(/SANDBOX_RUNNER_URL/);
  });

  it('容器模式缺少密钥时失败关闭', () => {
    expect(() =>
      assertSandboxConfigured(
        resolveSandboxConfig({ SANDBOX_RUNNER_URL: 'http://sandbox:8090' }),
      ),
    ).toThrow(/SANDBOX_RUNNER_TOKEN/);
  });

  it('vm 模式不校验 Runner 配置', () => {
    expect(() =>
      assertSandboxConfigured(resolveSandboxConfig({ LOOMFLOW_CODE_SANDBOX: 'vm' })),
    ).not.toThrow();
  });
});
