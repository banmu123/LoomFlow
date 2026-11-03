import {
  CodeExecutionError,
  CodeSandboxUnavailableError,
  CodeTimeoutError,
} from './types';

interface SandboxResponse {
  ok: boolean;
  result?: unknown;
  error?: { code?: string; message?: string };
}

const DEFAULT_TIMEOUT_MESSAGE = (seconds: number) => `代码执行超时（${seconds}s 限制）`;

/**
 * 调用独立的 Sandbox Runner（容器模式）。
 *
 * 任何网络/鉴权/容量问题一律抛 CodeSandboxUnavailableError —— 失败关闭，
 * 调用方（CodeExecutor）不会再退回 node:vm。
 */
export async function executeInContainerSandbox(input: {
  url: string;
  token: string;
  code: string;
  inputs: Record<string, unknown>;
  timeoutMs: number;
}): Promise<unknown> {
  const { url, token, code, inputs, timeoutMs } = input;
  const seconds = Math.round(timeoutMs / 1000);

  let response: Response;
  try {
    response = await fetch(`${url}/execute`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-loomflow-sandbox-token': token,
      },
      body: JSON.stringify({ code, inputs, timeoutMs }),
      signal: AbortSignal.timeout(timeoutMs + 3000),
    });
  } catch (err) {
    const reason = (err as Error).name === 'TimeoutError' ? '请求超时' : (err as Error).message;
    throw new CodeSandboxUnavailableError(`代码沙箱不可用：${reason}`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new CodeSandboxUnavailableError('代码沙箱鉴权失败：请检查 SANDBOX_RUNNER_TOKEN 是否一致');
  }
  if (response.status === 429) {
    throw new CodeSandboxUnavailableError('代码沙箱繁忙：并发已满，请稍后重试');
  }
  if (response.status >= 500) {
    throw new CodeSandboxUnavailableError(`代码沙箱不可用：HTTP ${response.status}`);
  }

  let body: SandboxResponse;
  try {
    body = (await response.json()) as SandboxResponse;
  } catch {
    throw new CodeSandboxUnavailableError('代码沙箱返回了非 JSON 响应');
  }

  if (body.ok) return body.result;

  const errorCode = body.error?.code;
  const message = body.error?.message || '代码执行失败';

  if (errorCode === 'timeout') {
    throw new CodeTimeoutError(message || DEFAULT_TIMEOUT_MESSAGE(seconds));
  }
  if (errorCode === 'sandbox_busy') {
    throw new CodeSandboxUnavailableError('代码沙箱繁忙：并发已满，请稍后重试');
  }
  if (errorCode === 'sandbox_failure' || errorCode === 'unauthorized') {
    throw new CodeSandboxUnavailableError(`代码沙箱异常：${message}`);
  }

  throw new CodeExecutionError(message);
}
