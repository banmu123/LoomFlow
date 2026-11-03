import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { StdioTransport } from '../stdio-transport';
import { McpClient } from '../client';

const FIXTURE = path.resolve(__dirname, 'fixtures/mcp-stdio-server.js');

function makeClient(timeoutMs = 3000): McpClient {
  return new McpClient(
    {
      id: 'stdio-1',
      name: 'fixture',
      transport: 'stdio',
      command: process.execPath,
      args: [FIXTURE],
      scope: 'read',
      timeoutMs,
    },
    { allowedCommands: [path.basename(process.execPath)] },
  );
}

describe('MCP STDIO 传输（真实子进程）', () => {
  it('发现工具并调用', async () => {
    const client = makeClient();
    const tools = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['echo', 'slow']);

    const result = await client.callTool('echo', { value: 'hello' });
    expect(JSON.parse(result.text)).toEqual({ value: 'hello' });
    expect(result.isError).toBe(false);

    await client.close();
  });

  it('工具调用超时会终止进程并报错', async () => {
    const client = makeClient(300);
    await client.listTools();

    await expect(client.callTool('slow', {})).rejects.toMatchObject({ code: 'timeout' });
    await client.close();
  }, 10_000);

  it('命令不在允许列表时拒绝启动', async () => {
    const client = new McpClient(
      {
        id: 'stdio-2',
        name: 'blocked',
        transport: 'stdio',
        command: process.execPath,
        args: [FIXTURE],
        scope: 'read',
      },
      { allowedCommands: ['node'] },
    );

    await expect(client.listTools()).rejects.toMatchObject({ code: 'unsafe_url' });
  });

  it('传输层直接拒绝未授权命令', async () => {
    const transport = new StdioTransport({
      command: 'node',
      allowedCommands: ['python'],
    });
    await expect(transport.request('initialize', {})).rejects.toMatchObject({ code: 'unsafe_url' });
  });
});
