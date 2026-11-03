import { StreamableHttpTransport } from './http-transport';
import { StdioTransport } from './stdio-transport';
import { McpError, TOOL_NAME_PATTERN, type McpServerConfig, type McpToolCallResult, type McpToolDefinition } from './types';

export const MCP_PROTOCOL_VERSION = '2025-06-18';
const MAX_TOOL_TEXT = 50_000;

function normaliseTool(raw: unknown): McpToolDefinition | null {
  if (!raw || typeof raw !== 'object') return null;
  const tool = raw as { name?: unknown; description?: unknown; inputSchema?: unknown; annotations?: unknown };
  if (typeof tool.name !== 'string' || !TOOL_NAME_PATTERN.test(tool.name)) return null;

  return {
    name: tool.name,
    description: typeof tool.description === 'string' ? tool.description.slice(0, 2000) : undefined,
    inputSchema:
      tool.inputSchema && typeof tool.inputSchema === 'object'
        ? (tool.inputSchema as Record<string, unknown>)
        : { type: 'object', properties: {} },
    annotations:
      tool.annotations && typeof tool.annotations === 'object'
        ? (tool.annotations as Record<string, unknown>)
        : undefined,
  };
}

/**
 * MCP 客户端：initialize → tools/list → tools/call。
 * 刻意不实现 resources/prompts/sampling，避免为未使用的协议特性增加攻击面。
 */
export class McpClient {
  private readonly transport: StreamableHttpTransport | StdioTransport;
  private connected = false;
  private serverVersion = MCP_PROTOCOL_VERSION;

  constructor(
    private readonly config: McpServerConfig,
    options: { allowedCommands?: string[] } = {},
  ) {
    this.transport =
      config.transport === 'stdio'
        ? new StdioTransport({
            command: config.command ?? '',
            args: config.args,
            env: config.env,
            timeoutMs: config.timeoutMs,
            allowedCommands: options.allowedCommands ?? [],
          })
        : new StreamableHttpTransport({
            url: config.url ?? '',
            headers: config.headers,
            timeoutMs: config.timeoutMs,
          });
  }

  get serverName(): string {
    return this.config.name;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const result = (await this.transport.request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'loomflow', version: '0.1.0' },
    })) as { protocolVersion?: string } | null;

    if (result?.protocolVersion && typeof result.protocolVersion === 'string') {
      this.serverVersion = result.protocolVersion;
    }
    if (this.transport instanceof StreamableHttpTransport) {
      this.transport.setProtocolVersion(this.serverVersion);
    }

    await this.transport.notify('notifications/initialized', {});
    this.connected = true;
  }

  async listTools(): Promise<McpToolDefinition[]> {
    await this.connect();
    const tools: McpToolDefinition[] = [];
    let cursor: string | undefined;

    // 最多 5 页，防止异常 Server 无限分页
    for (let page = 0; page < 5; page += 1) {
      const result = (await this.transport.request('tools/list', cursor ? { cursor } : {})) as {
        tools?: unknown[];
        nextCursor?: string;
      } | null;

      for (const raw of result?.tools ?? []) {
        const tool = normaliseTool(raw);
        if (tool) tools.push(tool);
      }

      cursor = typeof result?.nextCursor === 'string' ? result.nextCursor : undefined;
      if (!cursor) break;
    }

    return tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    options: { timeoutMs?: number } = {},
  ): Promise<McpToolCallResult> {
    if (!TOOL_NAME_PATTERN.test(name)) {
      throw new McpError('tool_not_found', `非法工具名：${name}`);
    }
    await this.connect();

    const result = (await this.transport.request(
      'tools/call',
      { name, arguments: args },
      options.timeoutMs,
    )) as {
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
      structuredContent?: unknown;
    } | null;

    const content = Array.isArray(result?.content)
      ? result.content
          .filter((item) => item && typeof item === 'object')
          .map((item) => ({
            type: typeof item.type === 'string' ? item.type : 'unknown',
            text: typeof item.text === 'string' ? item.text : undefined,
          }))
      : [];

    // 工具输出视为不可信数据：只取文本，截断后交给模型
    const text = content
      .map((item) => item.text ?? '')
      .filter(Boolean)
      .join('\n')
      .slice(0, MAX_TOOL_TEXT);

    return {
      content,
      isError: result?.isError === true,
      structuredContent: result?.structuredContent,
      text,
    };
  }

  async close(): Promise<void> {
    this.connected = false;
    await this.transport.close();
  }
}
