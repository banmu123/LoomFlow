import { isSafeHttpUrl } from '@/lib/url-security';
import { McpError } from './types';

/**
 * MCP 地址/命令安全校验。
 *
 * - HTTP Server：必须是 http/https，且不能指向内网/回环/云元数据（复用 URL 安全模块）
 * - 可选 host 白名单（MCP_ALLOWED_HOSTS）：配置后只允许列出的域名
 * - STDIO：命令必须命中部署级 allowlist，普通用户无法通过接口指定
 */

export function parseHostAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function parseCommandAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function assertHttpServerAllowed(
  rawUrl: string,
  allowedHosts: string[] = [],
): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new McpError('invalid_config', 'MCP Server URL 格式无效');
  }

  const check = await isSafeHttpUrl(rawUrl);
  if (!check.ok) {
    throw new McpError('unsafe_url', `MCP Server 地址不安全：${check.reason}`);
  }

  if (allowedHosts.length > 0) {
    const host = url.hostname.toLowerCase();
    const allowed = allowedHosts.some(
      (entry) => host === entry || host.endsWith(`.${entry}`),
    );
    if (!allowed) {
      throw new McpError('unsafe_url', `MCP Server 域名不在白名单内：${host}`);
    }
  }
}

export function assertStdioCommandAllowed(command: string, allowlist: string[]): void {
  const name = command.split(/[\\/]/).pop() ?? '';
  if (!name || !allowlist.includes(name)) {
    throw new McpError(
      'unsafe_url',
      `STDIO 命令未在允许列表中：${name || command}`,
    );
  }
}

/** 工具参数必须是纯 JSON 对象：拒绝原型污染与非对象输入 */
export function sanitiseToolArguments(args: unknown): Record<string, unknown> {
  if (args === undefined || args === null) return {};
  if (typeof args !== 'object' || Array.isArray(args)) {
    throw new McpError('invalid_config', 'MCP 工具参数必须是 JSON 对象');
  }

  const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (forbidden.has(key)) continue;
    output[key] = value;
  }
  return output;
}
