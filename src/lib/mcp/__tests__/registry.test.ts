import { describe, it, expect, vi } from 'vitest';
import { McpRegistry, type McpServerRecord } from '../registry';
import type { McpClient } from '../client';
import type { McpToolDefinition } from '../types';

function tools(): McpToolDefinition[] {
  return [
    { name: 'read_doc', inputSchema: { type: 'object' }, description: 'read' },
    { name: 'write_doc', inputSchema: { type: 'object' }, description: 'write' },
  ];
}

function fakeClient(
  call = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
    content: [],
    isError: false,
    text: 'ok',
  })),
): McpClient {
  return {
    listTools: vi.fn(async () => tools()),
    callTool: call,
    close: vi.fn(async () => {}),
  } as unknown as McpClient;
}

function makeRegistry(records: McpServerRecord[], client = fakeClient()) {
  return {
    client,
    registry: new McpRegistry({
      loadServers: async () => records,
      createClient: () => client,
      now: () => 0,
      ttlMs: 60_000,
      allowedHosts: [],
      allowedCommands: [],
    }),
  };
}

const baseServer: McpServerRecord = {
  id: 's1',
  name: 'demo',
  user_id: 'user-1',
  transport: 'http',
  url: 'https://mcp.example.com/mcp',
  allowed_tools: null,
  scope: 'read',
  enabled: true,
};

describe('MCP 工具注册表', () => {
  it('发现工具并缓存（不重复连接）', async () => {
    const { registry, client } = makeRegistry([baseServer]);

    expect(await registry.getTools('s1', 'user-1')).toHaveLength(2);
    expect(await registry.getTools('s1', 'user-1')).toHaveLength(2);
    expect(client.listTools).toHaveBeenCalledTimes(1);
  });

  it('禁止访问他人的 Server', async () => {
    const { registry } = makeRegistry([baseServer]);
    await expect(registry.getTools('s1', 'user-2')).rejects.toMatchObject({
      code: 'permission_denied',
    });
  });

  it('工具白名单之外的调用被拒绝', async () => {
    const { registry } = makeRegistry([{ ...baseServer, allowed_tools: ['read_doc'] }]);
    await expect(
      registry.callTool({ serverId: 's1', tool: 'write_doc', userId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'tool_not_found' });
  });

  it('权限级别不足被拒绝', async () => {
    const { registry } = makeRegistry([{ ...baseServer, scope: 'write' }]);
    await expect(
      registry.callTool({ serverId: 's1', tool: 'read_doc', userId: 'user-1', callerScope: 'read' }),
    ).rejects.toMatchObject({ code: 'permission_denied' });
  });

  it('危险操作必须显式审批', async () => {
    const { registry } = makeRegistry([{ ...baseServer, scope: 'dangerous' }]);

    await expect(
      registry.callTool({
        serverId: 's1',
        tool: 'read_doc',
        userId: 'user-1',
        callerScope: 'dangerous',
      }),
    ).rejects.toMatchObject({ code: 'permission_denied', details: { approvalRequired: true } });

    await expect(
      registry.callTool({
        serverId: 's1',
        tool: 'read_doc',
        userId: 'user-1',
        callerScope: 'dangerous',
        approved: true,
      }),
    ).resolves.toMatchObject({ text: 'ok' });
  });

  it('过滤原型污染参数', async () => {
    const call = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
      content: [],
      isError: false,
      text: 'ok',
    }));
    const { registry } = makeRegistry([baseServer], fakeClient(call));

    await registry.callTool({
      serverId: 's1',
      tool: 'read_doc',
      userId: 'user-1',
      arguments: { __proto__: { polluted: true }, safe: 1 },
    });

    const args = call.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(args)).toEqual(['safe']);
  });

  it('内网地址的 Server 被 SSRF 拦截', async () => {
    const registry = new McpRegistry({
      loadServers: async () => [{ ...baseServer, url: 'http://127.0.0.1:8080/mcp' }],
      createClient: () => fakeClient(),
      now: () => 0,
      ttlMs: 1000,
      allowedHosts: [],
      allowedCommands: [],
    });

    await expect(registry.getTools('s1', 'user-1')).rejects.toMatchObject({ code: 'unsafe_url' });
  });
});
