import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { StreamableHttpTransport } from '../http-transport';
import { McpClient } from '../client';

let server: Server | null = null;

async function startServer(handler: (body: Record<string, unknown>, res: import('node:http').ServerResponse) => void) {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      handler(body, res);
    });
  });

  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return `http://127.0.0.1:${port}/mcp`;
}

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    server = null;
  });
});

describe('MCP Streamable HTTP 传输', () => {
  it('完成 initialize → tools/list → tools/call，并回传 Session', async () => {
    const seenSessions: Array<string | undefined> = [];
    const url = await startServer((body, res) => {
      seenSessions.push(res.req.headers['mcp-session-id'] as string | undefined);
      const method = body.method as string;

      if (method === 'initialize') {
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'fake', version: '1' } },
          }),
        );
        return;
      }
      if (method === 'notifications/initialized') {
        res.writeHead(202).end();
        return;
      }
      if (method === 'tools/list') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: { tools: [{ name: 'echo', description: 'echo', inputSchema: { type: 'object' } }] },
          }),
        );
        return;
      }
      if (method === 'tools/call') {
        // 用 SSE 返回，验证事件流解析
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'progress' })}\n\n`);
        res.write(
          `event: message\ndata: ${JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: { content: [{ type: 'text', text: '{"ok":true}' }], isError: false },
          })}\n\n`,
        );
        res.end();
        return;
      }
      res.writeHead(404).end();
    });

    const client = new McpClient({ id: 's1', name: 'fake', transport: 'http', url, scope: 'read' });
    await client.connect();
    const tools = await client.listTools();
    const result = await client.callTool('echo', { value: 42 });

    expect(tools.map((tool) => tool.name)).toEqual(['echo']);
    expect(result.text).toBe('{"ok":true}');
    expect(result.isError).toBe(false);
    // initialize 时没有 session，后续请求携带 sess-1
    expect(seenSessions[0]).toBeUndefined();
    expect(seenSessions[seenSessions.length - 1]).toBe('sess-1');

    await client.close();
  });

  it('JSON-RPC 错误转为 McpError', async () => {
    const url = await startServer((body, res) => {
      if (body.method === 'initialize') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } }));
        return;
      }
      if (body.method === 'notifications/initialized') return res.writeHead(202).end();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'method not found' } }),
      );
    });

    const transport = new StreamableHttpTransport({ url });
    await transport.request('initialize', {});
    await expect(transport.request('tools/list', {})).rejects.toMatchObject({
      code: 'server_error',
    });
  });

  it('请求超时返回 timeout 错误', async () => {
    const url = await startServer((body, res) => {
      if (body.method === 'initialize') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }));
        return;
      }
      // 永不响应
    });

    const transport = new StreamableHttpTransport({ url, timeoutMs: 200 });
    await transport.request('initialize', {});
    await expect(transport.request('slow/method', {}, 200)).rejects.toMatchObject({
      code: 'timeout',
    });
  });
});
