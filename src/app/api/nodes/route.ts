import { NextRequest } from 'next/server';
import { nodeRegistry } from '@/lib/tinyflow';
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

  return Response.json({
    total: nodes.length,
    nodes: nodes.map((n) => ({
      type: n.type,
      label: n.label,
      description: n.description,
      category: n.category,
      capabilities: n.capabilities || [],
    })),
  });
}
