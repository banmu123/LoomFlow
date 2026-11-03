import { McpError } from './types';
import { nextRequestId, parseSseResponse, unwrapResult } from './jsonrpc';
import { injectTraceContext } from '@/lib/telemetry';

export interface HttpTransportOptions {
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * MCP Streamable HTTP 传输（规范 2025-06-18）。
 *
 * 只实现工具链路需要的部分：
 * - POST JSON-RPC
 * - 响应可能是 application/json，也可能是 text/event-stream
 * - 记录 initialize 返回的 Mcp-Session-Id 与协议版本，后续请求回传
 */
export class StreamableHttpTransport {
  private sessionId?: string;
  private protocolVersion?: string;
  private closed = false;

  constructor(private readonly options: HttpTransportOptions) {}

  setProtocolVersion(version: string): void {
    this.protocolVersion = version;
  }

  get session(): string | undefined {
    return this.sessionId;
  }

  private headers(): Record<string, string> {
    return injectTraceContext({
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
      ...(this.protocolVersion ? { 'mcp-protocol-version': this.protocolVersion } : {}),
      ...(this.options.headers ?? {}),
    });
  }

  private async post(body: unknown, timeoutMs?: number): Promise<Response> {
    if (this.closed) throw new McpError('not_connected', 'MCP 连接已关闭');

    const limit = timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    try {
      const response = await fetch(this.options.url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(limit),
      });

      const session = response.headers.get('mcp-session-id');
      if (session) this.sessionId = session;
      return response;
    } catch (err) {
      const name = (err as Error).name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new McpError('timeout', `MCP 请求超时（${limit}ms）`);
      }
      throw new McpError('transport_error', `MCP 连接失败：${(err as Error).message}`);
    }
  }

  async request(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs?: number,
  ): Promise<unknown> {
    const id = nextRequestId();
    const response = await this.post({ jsonrpc: '2.0', id, method, params }, timeoutMs);

    if (response.status === 202) return null;
    if (response.status === 404) {
      throw new McpError('transport_error', 'MCP Session 已失效（404），请重新连接');
    }
    if (response.status === 401 || response.status === 403) {
      throw new McpError('transport_error', `MCP 鉴权失败（HTTP ${response.status}）`);
    }
    if (!response.ok) {
      const snippet = (await response.text().catch(() => '')).slice(0, 300);
      throw new McpError('transport_error', `MCP 请求失败（HTTP ${response.status}）${snippet}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) {
      const text = await response.text();
      return unwrapResult(parseSseResponse(text, id), method);
    }

    const body = (await response.json().catch(() => null)) as unknown;
    return unwrapResult(body, method);
  }

  /** 通知（无 id，不等待结果） */
  async notify(method: string, params: Record<string, unknown> = {}): Promise<void> {
    try {
      const response = await this.post({ jsonrpc: '2.0', method, params });
      // 通知只需确认传输成功；不读取响应体
      if (response.status >= 400 && response.status !== 404) {
        throw new McpError('transport_error', `MCP 通知失败（HTTP ${response.status}）`);
      }
    } catch (err) {
      if (err instanceof McpError) throw err;
      throw new McpError('transport_error', `MCP 通知失败：${(err as Error).message}`);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
