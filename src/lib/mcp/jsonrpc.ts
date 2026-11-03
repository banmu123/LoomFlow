import { McpError } from './types';

/** 极简 JSON-RPC 2.0 编码/解析（只覆盖 MCP 需要的部分）。 */

let sequence = 0;

export function nextRequestId(): number {
  sequence += 1;
  return sequence;
}

export interface JsonRpcErrorShape {
  jsonrpc: '2.0';
  id: number | string | null;
  error: { code: number; message: string; data?: unknown };
}

export function isJsonRpcError(message: unknown): message is JsonRpcErrorShape {
  return (
    !!message &&
    typeof message === 'object' &&
    'error' in message &&
    typeof (message as { error?: unknown }).error === 'object'
  );
}

export function unwrapResult(message: unknown, method: string): unknown {
  if (!message || typeof message !== 'object') {
    throw new McpError('protocol_error', `MCP ${method} 返回了非对象响应`);
  }
  if (isJsonRpcError(message)) {
    throw new McpError(
      'server_error',
      `MCP ${method} 失败：${message.error.message}`,
      { rpcCode: message.error.code },
    );
  }
  return (message as { result?: unknown }).result;
}

/**
 * 解析 SSE 响应，返回指定 id 的 JSON-RPC 消息。
 * 规范允许服务端用 SSE 推送多条消息（进度通知等），必须按 id 匹配。
 */
export function parseSseResponse(text: string, expectedId: number): unknown {
  const events = text.split(/\r?\n\r?\n/);
  let last: unknown = null;

  for (const event of events) {
    const dataLines = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());

    if (dataLines.length === 0) continue;
    const payload = dataLines.join('\n').trim();
    if (!payload || payload === '[DONE]') continue;

    try {
      const parsed = JSON.parse(payload) as { id?: number | string };
      if (parsed.id === expectedId) return parsed;
      last = parsed;
    } catch {
      // 非 JSON 的心跳/注释行忽略
    }
  }

  if (last) return last;
  throw new McpError('protocol_error', 'MCP SSE 响应中没有可解析的 JSON-RPC 消息');
}
