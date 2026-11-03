import { runPythonCode } from '@/lib/tinyflow/executors/PythonSandbox';
import { assertSandboxConfigured, resolveSandboxConfig } from './config';
import { executeInContainerSandbox } from './client';
import { runInVm } from './vm-runner';
import type { CodeLanguage } from './types';

export * from './types';
export { resolveSandboxConfig, assertSandboxConfigured } from './config';
export { executeInContainerSandbox } from './client';
export { runInVm } from './vm-runner';

let warnedLegacyVm = false;

function warnLegacyVmOnce(): void {
  if (warnedLegacyVm) return;
  warnedLegacyVm = true;
  if (process.env.COZE_PROJECT_ENV === 'PROD') {
    console.warn(
      '[sandbox] 警告：代码节点正在使用 node:vm（非安全边界）。' +
        '生产环境请配置 LOOMFLOW_CODE_SANDBOX=container 并启动 sandbox-runner。',
    );
  }
}

/**
 * 统一代码执行入口（Code Node → 本函数 → 隔离环境）。
 *
 * - javascript：容器沙箱（默认）或显式启用的 vm（仅开发）
 * - python：沿用 Pyodide/WASM（无宿主文件系统与网络，本身就是独立边界）
 *
 * 容器模式失败时直接抛错，不降级到 vm。
 */
export async function executeCode(input: {
  language: CodeLanguage;
  code: string;
  inputs: Record<string, unknown>;
  timeoutMs: number;
}): Promise<unknown> {
  if (input.language === 'python') {
    return runPythonCode(input.code, JSON.stringify(input.inputs ?? {}), input.timeoutMs);
  }

  const config = resolveSandboxConfig();

  if (config.mode === 'vm') {
    warnLegacyVmOnce();
    return runInVm(input.code, input.inputs, input.timeoutMs);
  }

  assertSandboxConfigured(config);
  return executeInContainerSandbox({
    url: config.url,
    token: config.token,
    code: input.code,
    inputs: input.inputs,
    timeoutMs: input.timeoutMs,
  });
}
