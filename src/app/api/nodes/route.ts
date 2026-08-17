import { NextRequest } from 'next/server';
import { nodeRegistry } from '@/lib/tinyflow';
import { validateNodeRegistry } from '@/lib/tinyflow/nodes/builtin';
import { resolveConfigOptions } from '@/lib/tinyflow/node-config';
import { loadCustomNodesForUser } from '@/lib/tinyflow/node-custom';
import { getCurrentUser } from '@/lib/server-auth';

// 节点库：返回 NodeRegistry 中全部节点定义（官方 + 自定义合并，按分类分组，含 configSchema）
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  // 加载该用户的自定义节点并合并进 registry（Phase 5：官方 + 自定义统一注册表）
  await loadCustomNodesForUser(user.id);

  const category = request.nextUrl.searchParams.get('category') || null;

  let nodes = nodeRegistry.list();
  if (category) {
    nodes = nodes.filter((n) => n.category === category);
  }

  // 运行时一致性校验（executorType 绑定执行器）
  const warnings = await validateNodeRegistry();

  // configSchema：resolve 动态选项（optionsProvider → 静态 options，函数不可 JSON 序列化）
  const resolved = await Promise.all(
    nodes.map(async (n) => ({
      ...n,
      configSchema: n.configSchema ? await resolveConfigOptions(n.configSchema) : undefined,
    })),
  );

  return Response.json({
    total: resolved.length,
    warnings,
    nodes: resolved.map((n) => ({
      type: n.type,
      label: n.label,
      description: n.description,
      category: n.category,
      capabilities: n.capabilities || [],
      configSchema: n.configSchema,
      version: n.version ?? 1,
      // 来源标识：官方（只读） / 自定义（可编辑）——Phase 5
      source: n.source ?? (n.builtin ? 'official' : 'custom'),
      editable: n.source === 'custom' || !n.builtin,
    })),
  });
}
