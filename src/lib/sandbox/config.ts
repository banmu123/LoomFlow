import { CodeSandboxUnavailableError, type SandboxMode } from './types';

export interface SandboxConfig {
  mode: SandboxMode;
  /** 沙箱 Runner 地址（容器模式必填） */
  url: string;
  /** 沙箱 Runner 内部服务密钥（容器模式必填） */
  token: string;
}

const VALID_MODES: SandboxMode[] = ['vm', 'container'];

/**
 * 解析代码沙箱配置。
 *
 * 默认 container：生产部署不允许把不可信代码交给 node:vm。
 * 只有显式 `LOOMFLOW_CODE_SANDBOX=vm` 才会走旧实现（本地开发/无沙箱环境的兜底，
 * 会打印一次安全告警）。
 */
export function resolveSandboxConfig(
  env: Record<string, string | undefined> = process.env,
): SandboxConfig {
  const raw = (env.LOOMFLOW_CODE_SANDBOX ?? 'container').trim().toLowerCase();
  if (!VALID_MODES.includes(raw as SandboxMode)) {
    throw new Error(
      `LOOMFLOW_CODE_SANDBOX 取值非法：${raw}（仅支持 vm / container）`,
    );
  }

  return {
    mode: raw as SandboxMode,
    url: (env.SANDBOX_RUNNER_URL ?? '').trim().replace(/\/+$/, ''),
    token: (env.SANDBOX_RUNNER_TOKEN ?? '').trim(),
  };
}

/** 容器模式缺少地址或密钥时立即失败（不做任何降级） */
export function assertSandboxConfigured(config: SandboxConfig): void {
  if (config.mode !== 'container') return;
  if (!config.url) {
    throw new CodeSandboxUnavailableError(
      '代码沙箱未配置：缺少 SANDBOX_RUNNER_URL（容器模式必须显式配置，不会回退到 node:vm）',
    );
  }
  if (!config.token) {
    throw new CodeSandboxUnavailableError(
      '代码沙箱未配置：缺少 SANDBOX_RUNNER_TOKEN（容器模式必须显式配置）',
    );
  }
}
