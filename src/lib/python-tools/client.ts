/** Python 工具服务（services/agent-tools）的调用客户端。 */

import { injectTraceContext, withSpan } from '@/lib/telemetry';

export const PYTHON_TOOL_PATHS = {
  'data.analyze': '/api/v1/tools/data/analyze',
  'data.transform': '/api/v1/tools/data/transform',
  'documents.parse': '/api/v1/tools/documents/parse',
  'text.clean': '/api/v1/tools/text/clean',
  extract: '/api/v1/tools/extract',
} as const;

export type PythonToolName = keyof typeof PYTHON_TOOL_PATHS;

export const PYTHON_TOOL_NAMES = Object.keys(PYTHON_TOOL_PATHS) as PythonToolName[];

export interface PythonToolsConfig {
  url: string;
  token: string;
}

export interface PythonToolMetadata {
  tool: string;
  duration_ms: number;
  truncated?: boolean;
  rows_scanned?: number | null;
}

export interface PythonToolResult {
  success: boolean;
  data: Record<string, unknown>;
  metadata: PythonToolMetadata;
}

/** 服务不可用：未配置、网络错误、鉴权失败、5xx —— 一律失败关闭 */
export class PythonToolUnavailableError extends Error {
  readonly code = 'tool_unavailable';
  constructor(message: string) {
    super(message);
    this.name = 'PythonToolUnavailableError';
  }
}

export class PythonToolTimeoutError extends Error {
  readonly code = 'timeout';
  constructor(message: string) {
    super(message);
    this.name = 'PythonToolTimeoutError';
  }
}

/** 工具执行失败（输入不合法、列不存在等）：属于用户可修复的错误 */
export class PythonToolError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'PythonToolError';
    this.code = code;
    this.details = details;
  }
}

export function resolvePythonToolsConfig(
  env: Record<string, string | undefined> = process.env,
): PythonToolsConfig {
  return {
    url: (env.AGENT_TOOLS_URL ?? '').trim().replace(/\/+$/, ''),
    token: (env.AGENT_TOOLS_TOKEN ?? '').trim(),
  };
}

export function assertPythonToolsConfigured(config: PythonToolsConfig): void {
  if (!config.url) {
    throw new PythonToolUnavailableError(
      'Python 工具服务未配置：缺少 AGENT_TOOLS_URL（可执行 docker compose --profile ai-tools up -d）',
    );
  }
  if (!config.token) {
    throw new PythonToolUnavailableError('Python 工具服务未配置：缺少 AGENT_TOOLS_TOKEN');
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: unknown };
}

export async function callPythonTool(
  name: PythonToolName,
  payload: Record<string, unknown>,
  options: {
    timeoutMs?: number;
    config?: PythonToolsConfig;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<PythonToolResult> {
  const config = options.config ?? resolvePythonToolsConfig();
  assertPythonToolsConfigured(config);

  const path = PYTHON_TOOL_PATHS[name];
  if (!path) {
    throw new PythonToolError('unknown_tool', `未知 Python 工具：${name}`);
  }

  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 25_000, 1000), 120_000);
  const doFetch = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await withSpan(
      'python_tool.call',
      { 'tool.name': name, 'tool.timeout_ms': timeoutMs },
      () =>
        doFetch(`${config.url}${path}`, {
          method: 'POST',
          headers: injectTraceContext({
            'content-type': 'application/json',
            'x-loomflow-service-token': config.token,
          }),
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs + 2000),
        }),
    );
  } catch (err) {
    const reason = (err as Error).name === 'TimeoutError' ? '请求超时' : (err as Error).message;
    throw new PythonToolUnavailableError(`Python 工具服务不可用：${reason}`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new PythonToolUnavailableError('Python 工具服务鉴权失败：请检查 AGENT_TOOLS_TOKEN 是否一致');
  }
  if (response.status === 503) {
    throw new PythonToolUnavailableError('Python 工具服务不可用（503）');
  }
  if (response.status >= 500 && response.status !== 504) {
    throw new PythonToolUnavailableError(`Python 工具服务异常（HTTP ${response.status}）`);
  }

  let body: PythonToolResult & ErrorEnvelope;
  try {
    body = (await response.json()) as PythonToolResult & ErrorEnvelope;
  } catch {
    throw new PythonToolUnavailableError('Python 工具服务返回了非 JSON 响应');
  }

  if (response.ok && body.success) {
    return body;
  }

  const code = body.error?.code ?? 'tool_error';
  const message = body.error?.message ?? `工具执行失败（HTTP ${response.status}）`;

  if (response.status === 504 || code === 'timeout') {
    throw new PythonToolTimeoutError(message);
  }

  throw new PythonToolError(code, message, body.error?.details);
}
