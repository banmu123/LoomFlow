/** MCP（Model Context Protocol）客户端的最小类型集合。 */

export type McpTransportType = 'http' | 'stdio';

export type ToolScope = 'read' | 'write' | 'dangerous';

export const SCOPE_RANK: Record<ToolScope, number> = {
  read: 0,
  write: 1,
  dangerous: 2,
};

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransportType;
  /** HTTP 传输 */
  url?: string;
  headers?: Record<string, string>;
  /** STDIO 传输（仅部署级配置，不允许普通用户填写） */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** 工具白名单；null/undefined = 允许发现到的全部工具 */
  allowedTools?: string[] | null;
  /** 该 Server 下工具的默认权限级别 */
  scope: ToolScope;
  timeoutMs?: number;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  /** 来自 Server 的额外注解（只读提示等） */
  annotations?: Record<string, unknown>;
}

export interface McpToolCallResult {
  content: Array<{ type: string; text?: string }>;
  isError: boolean;
  structuredContent?: unknown;
  /** 供模型消费的纯文本（截断后） */
  text: string;
}

export type McpErrorCode =
  | 'invalid_config'
  | 'unsafe_url'
  | 'transport_error'
  | 'protocol_error'
  | 'timeout'
  | 'not_connected'
  | 'tool_not_found'
  | 'tool_not_allowed'
  | 'permission_denied'
  | 'server_error';

export class McpError extends Error {
  readonly code: McpErrorCode;
  readonly details?: unknown;

  constructor(code: McpErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.details = details;
  }
}

/** 工具名只允许安全字符（同时用于日志与审计，避免注入） */
export const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
