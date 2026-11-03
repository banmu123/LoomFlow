/** 代码执行适配层的公共类型与错误。 */

export type CodeLanguage = 'javascript' | 'python';

export type SandboxMode = 'vm' | 'container';

/** 沙箱不可用：必须失败关闭，绝不回退到 vm 执行 */
export class CodeSandboxUnavailableError extends Error {
  readonly code = 'sandbox_unavailable';

  constructor(message: string) {
    super(message);
    this.name = 'CodeSandboxUnavailableError';
  }
}

export class CodeTimeoutError extends Error {
  readonly code = 'timeout';

  constructor(message: string) {
    super(message);
    this.name = 'CodeTimeoutError';
  }
}

export class CodeExecutionError extends Error {
  readonly code = 'execution_error';

  constructor(message: string) {
    super(message);
    this.name = 'CodeExecutionError';
  }
}
