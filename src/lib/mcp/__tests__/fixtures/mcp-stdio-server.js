'use strict';
// 测试用 MCP Server：newline-delimited JSON-RPC over stdio
let buffer = '';

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function handle(message) {
  const { id, method, params } = message;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'fixture', version: '1.0.0' },
      },
    });
    return;
  }
  if (method === 'notifications/initialized') return;

  if (method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'echo',
            description: 'echo arguments',
            inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
          },
          { name: 'slow', description: 'never responds', inputSchema: { type: 'object' } },
        ],
      },
    });
    return;
  }

  if (method === 'tools/call') {
    if (params.name === 'echo') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(params.arguments) }],
          isError: false,
        },
      });
      return;
    }
    if (params.name === 'slow') return;
  }

  send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } });
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf('\n');
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) handle(JSON.parse(line));
    index = buffer.indexOf('\n');
  }
});
