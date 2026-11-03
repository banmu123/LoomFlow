import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { supabase } from '@/lib/supabase/server';
import { encryptSecret } from '@/lib/secrets';
import { logAudit, getClientIp } from '@/lib/audit';
import {
  assertHttpServerAllowed,
  mcpRegistry,
  parseHostAllowlist,
  type ToolScope,
} from '@/lib/mcp';

export const runtime = 'nodejs';

const SCOPES: ToolScope[] = ['read', 'write', 'dangerous'];

// MCP Server 列表（当前用户可见的部署级 + 自己的；不含凭据）
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  try {
    const servers = await mcpRegistry.listServers(user.id);
    return Response.json(
      servers.map((server) => ({
        id: server.id,
        name: server.name,
        transport: server.transport,
        scope: server.scope,
        toolCount: server.toolCount,
        tools: server.tools?.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
        error: server.error,
      })),
    );
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

// 新增 MCP Server（仅 Streamable HTTP；STDIO 由部署配置管理）
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const name = String(body?.name ?? '').trim();
  const url = String(body?.url ?? '').trim();
  const scope = SCOPES.includes(body?.scope) ? (body.scope as ToolScope) : 'read';
  const allowedTools = Array.isArray(body?.allowedTools)
    ? body.allowedTools.map(String).slice(0, 200)
    : null;

  if (!name || name.length > 64) {
    return Response.json({ error: '名称不能为空且不超过 64 字符' }, { status: 400 });
  }
  if (!url) {
    return Response.json({ error: 'URL 不能为空' }, { status: 400 });
  }

  // SSRF 防护：创建时就校验，避免把内网地址存进库
  try {
    await assertHttpServerAllowed(url, parseHostAllowlist(process.env.MCP_ALLOWED_HOSTS));
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }

  const headers: Record<string, string> = {};
  if (body?.headers && typeof body.headers === 'object' && !Array.isArray(body.headers)) {
    for (const [key, value] of Object.entries(body.headers as Record<string, unknown>)) {
      if (typeof value === 'string' && key.length <= 64) headers[key] = value;
    }
  }

  const { data, error } = await supabase
    .from('mcp_servers')
    .insert({
      user_id: user.id,
      name,
      url,
      credentials: Object.keys(headers).length > 0 ? encryptSecret(JSON.stringify(headers)) : null,
      allowed_tools: allowedTools,
      scope,
      enabled: true,
    })
    .select('id, name, url, scope, allowed_tools, enabled, created_at')
    .single();

  if (error) {
    const message = error.code === '23505' ? '同名 MCP Server 已存在' : error.message;
    return Response.json({ error: message }, { status: 400 });
  }

  await logAudit({
    userId: user.id,
    username: user.username,
    action: 'mcp_server_create',
    detail: { serverId: data.id, name, scope },
    ip: getClientIp(request),
  });

  return Response.json(data, { status: 201 });
}
