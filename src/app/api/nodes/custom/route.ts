import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import {
  listCustomNodes,
  createCustomNode,
  loadCustomNodesForUser,
} from '@/lib/tinyflow/node-custom';
import type { NodeDefinition } from '@/lib/tinyflow/node-definition';

export const runtime = 'nodejs';

// 自定义节点库：列表（GET）/ 创建（POST）
// 基于现有 NodeRegistry 体系——创建即注册，引擎/校验/节点库面板自动生效
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  await loadCustomNodesForUser(user.id);
  const nodes = await listCustomNodes(user.id);
  return Response.json({ nodes });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Partial<NodeDefinition> | null;
  if (!body?.type || !body?.label) {
    return Response.json({ error: '节点类型和名称不能为空' }, { status: 400 });
  }

  const result = await createCustomNode(user.id, body as NodeDefinition);
  if (result.error) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json({ node: result.node }, { status: 201 });
}
