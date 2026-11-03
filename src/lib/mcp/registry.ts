import { supabase } from '@/lib/supabase/server';
import { decryptSecret } from '@/lib/secrets';
import { McpClient } from './client';
import {
  assertHttpServerAllowed,
  parseCommandAllowlist,
  parseHostAllowlist,
  sanitiseToolArguments,
} from './security';
import {
  McpError,
  SCOPE_RANK,
  type McpToolCallResult,
  type McpToolDefinition,
  type ToolScope,
} from './types';

export interface McpServerRecord {
  id: string;
  name: string;
  user_id: string | null;
  transport: 'http' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  allowed_tools: string[] | null;
  scope: ToolScope;
  enabled: boolean;
}

export interface McpServerSummary {
  id: string;
  name: string;
  transport: 'http' | 'stdio';
  scope: ToolScope;
  toolCount: number;
  tools?: McpToolDefinition[];
  error?: string;
}

interface CacheEntry {
  client: McpClient;
  tools: McpToolDefinition[];
  expiresAt: number;
}

const DEFAULT_TTL_MS = 60_000;

interface DbRow {
  id: string;
  name: string;
  user_id: string | null;
  url: string | null;
  credentials: string | null;
  allowed_tools: string[] | null;
  scope: ToolScope;
  enabled: boolean;
}

function parseCredentials(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const decrypted = decryptSecret(raw);
    const parsed = JSON.parse(decrypted) as Record<string, unknown>;
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && key.length <= 64 && value.length <= 4096) {
        headers[key] = value;
      }
    }
    return headers;
  } catch {
    console.warn('[mcp] 凭据解析失败，已忽略该 Server 的自定义请求头');
    return {};
  }
}

/** 部署级 STDIO Server（普通用户无法通过 API 添加） */
function loadStdioServers(): McpServerRecord[] {
  const raw = process.env.MCP_STDIO_SERVERS_JSON;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
    return parsed
      .filter((item) => typeof item.name === 'string' && typeof item.command === 'string')
      .map((item, index) => ({
        id: `stdio:${String(item.name)}:${index}`,
        name: String(item.name),
        user_id: null,
        transport: 'stdio' as const,
        command: String(item.command),
        args: Array.isArray(item.args) ? item.args.map(String) : [],
        env:
          item.env && typeof item.env === 'object'
            ? Object.fromEntries(
                Object.entries(item.env as Record<string, unknown>)
                  .filter(([, v]) => typeof v === 'string')
                  .map(([k, v]) => [k, String(v)]),
              )
            : undefined,
        allowed_tools: Array.isArray(item.allowedTools) ? item.allowedTools.map(String) : null,
        scope: (['read', 'write', 'dangerous'].includes(String(item.scope))
          ? String(item.scope)
          : 'read') as ToolScope,
        enabled: true,
      }));
  } catch {
    console.warn('[mcp] MCP_STDIO_SERVERS_JSON 解析失败，已忽略');
    return [];
  }
}

async function loadServersFromDb(): Promise<McpServerRecord[]> {
  const { data, error } = await supabase
    .from('mcp_servers')
    .select('id, name, user_id, url, credentials, allowed_tools, scope, enabled')
    .eq('enabled', true);

  if (error || !data) return [];

  return (data as DbRow[])
    .filter((row) => typeof row.url === 'string' && row.url.length > 0)
    .map((row) => ({
      id: row.id,
      name: row.name,
      user_id: row.user_id,
      transport: 'http' as const,
      url: row.url as string,
      headers: parseCredentials(row.credentials),
      allowed_tools: Array.isArray(row.allowed_tools) ? row.allowed_tools : null,
      scope: (['read', 'write', 'dangerous'].includes(row.scope) ? row.scope : 'read') as ToolScope,
      enabled: true,
    }));
}

export interface McpRegistryOptions {
  loadServers: () => Promise<McpServerRecord[]>;
  createClient: (record: McpServerRecord) => McpClient;
  now: () => number;
  ttlMs: number;
  allowedHosts: string[];
  allowedCommands: string[];
}

export class McpRegistry {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly options: McpRegistryOptions;

  constructor(overrides: Partial<McpRegistryOptions> = {}) {
    this.options = {
      loadServers: async () => [...(await loadServersFromDb()), ...loadStdioServers()],
      createClient: (record) =>
        new McpClient(
          {
            id: record.id,
            name: record.name,
            transport: record.transport,
            url: record.url,
            command: record.command,
            args: record.args,
            env: record.env,
            headers: record.headers,
            allowedTools: record.allowed_tools,
            scope: record.scope,
            timeoutMs: 20_000,
          },
          { allowedCommands: this.options.allowedCommands },
        ),
      now: () => Date.now(),
      ttlMs: DEFAULT_TTL_MS,
      allowedHosts: parseHostAllowlist(process.env.MCP_ALLOWED_HOSTS),
      allowedCommands: parseCommandAllowlist(process.env.MCP_STDIO_ALLOWLIST),
      ...overrides,
    };
  }

  async closeAll(): Promise<void> {
    for (const [, entry] of this.cache) {
      await entry.client.close().catch(() => {});
    }
    this.cache.clear();
  }

  private async findServer(serverId: string, userId?: string): Promise<McpServerRecord> {
    const servers = await this.options.loadServers();
    const server = servers.find((item) => item.id === serverId && item.enabled);
    if (!server) {
      throw new McpError('not_connected', `MCP Server 不存在或未启用：${serverId}`);
    }
    // 归属校验：用户只能使用自己的 Server（部署级 Server 的 user_id 为空）
    if (server.user_id && userId && server.user_id !== userId) {
      throw new McpError('permission_denied', '无权访问该 MCP Server');
    }
    return server;
  }

  private async connect(server: McpServerRecord): Promise<CacheEntry> {
    const cached = this.cache.get(server.id);
    if (cached && cached.expiresAt > this.options.now()) return cached;

    if (cached) {
      await cached.client.close().catch(() => {});
      this.cache.delete(server.id);
    }

    if (server.transport === 'http') {
      await assertHttpServerAllowed(server.url ?? '', this.options.allowedHosts);
    }

    const client = this.options.createClient(server);

    try {
      const tools = await client.listTools();
      const filtered = server.allowed_tools
        ? tools.filter((tool) => server.allowed_tools?.includes(tool.name))
        : tools;

      const entry: CacheEntry = {
        client,
        tools: filtered,
        expiresAt: this.options.now() + this.options.ttlMs,
      };
      this.cache.set(server.id, entry);
      return entry;
    } catch (err) {
      await client.close().catch(() => {});
      throw err;
    }
  }

  /** 列出可用 Server 及其工具（不含凭据） */
  async listServers(userId?: string): Promise<McpServerSummary[]> {
    const servers = await this.options.loadServers();
    const visible = servers.filter(
      (server) => server.enabled && (!server.user_id || !userId || server.user_id === userId),
    );

    const summaries: McpServerSummary[] = [];
    for (const server of visible) {
      try {
        const entry = await this.connect(server);
        summaries.push({
          id: server.id,
          name: server.name,
          transport: server.transport,
          scope: server.scope,
          toolCount: entry.tools.length,
          tools: entry.tools,
        });
      } catch (err) {
        summaries.push({
          id: server.id,
          name: server.name,
          transport: server.transport,
          scope: server.scope,
          toolCount: 0,
          error: (err as Error).message,
        });
      }
    }
    return summaries;
  }

  async getTools(serverId: string, userId?: string): Promise<McpToolDefinition[]> {
    const server = await this.findServer(serverId, userId);
    const entry = await this.connect(server);
    if (server.allowed_tools) {
      return entry.tools.filter((tool) => server.allowed_tools?.includes(tool.name));
    }
    return entry.tools;
  }

  async callTool(input: {
    serverId: string;
    tool: string;
    arguments?: unknown;
    userId?: string;
    /** 调用方自身具备的权限级别（默认 read） */
    callerScope?: ToolScope;
    /** 危险操作的人工审批标记 */
    approved?: boolean;
    timeoutMs?: number;
  }): Promise<McpToolCallResult> {
    const server = await this.findServer(input.serverId, input.userId);
    const entry = await this.connect(server);

    const tool = entry.tools.find((item) => item.name === input.tool);
    if (!tool) {
      throw new McpError('tool_not_found', `工具不存在或未被允许：${input.tool}`);
    }
    if (server.allowed_tools && !server.allowed_tools.includes(tool.name)) {
      throw new McpError('tool_not_allowed', `工具不在白名单内：${tool.name}`);
    }

    const required = server.scope;
    const callerScope = input.callerScope ?? 'read';
    if (SCOPE_RANK[callerScope] < SCOPE_RANK[required]) {
      throw new McpError(
        'permission_denied',
        `调用该工具需要 ${required} 权限（当前 ${callerScope}）`,
      );
    }
    if (required === 'dangerous' && input.approved !== true) {
      throw new McpError('permission_denied', '该工具标记为危险操作，需要人工审批', {
        approvalRequired: true,
        tool: tool.name,
      });
    }

    const args = sanitiseToolArguments(input.arguments);
    return entry.client.callTool(tool.name, args, { timeoutMs: input.timeoutMs });
  }
}

export const mcpRegistry = new McpRegistry();
