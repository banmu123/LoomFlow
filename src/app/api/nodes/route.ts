import { NextRequest } from 'next/server';
import { nodeRegistry } from '@/lib/tinyflow';
import { validateNodeRegistry } from '@/lib/tinyflow/nodes/builtin';
import { getCurrentUser } from '@/lib/server-auth';

// 节点库：返回 NodeRegistry 中全部节点定义（按分类分组）
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const category = request.nextUrl.searchParams.get('category') || null;

  let nodes = nodeRegistry.list();
  if (category) {
    nodes = nodes.filter((n) => n.category === category);
  }

  // 运行时一致性校验（executorType 绑定执行器）
  const warnings = await validateNodeRegistry();

  return Response.json({
    total: nodes.length,
    warnings,
    nodes: nodes.map((n) => ({
      type: n.type,
      label: n.label,
      description: n.description,
      category: n.category,
      capabilities: n.capabilities || [],
    })),
  });
}
