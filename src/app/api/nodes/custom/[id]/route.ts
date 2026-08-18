import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/server-auth';
import {
  updateCustomNode,
  deleteCustomNode,
  duplicateCustomNode,
} from '@/lib/tinyflow/node-custom';
import type { NodeDefinition } from '@/lib/tinyflow/node-definition';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

// 读取单个自定义节点（返回注册形态）
export async function GET(_request: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const { id } = await params;
  const { data } = await supabase
    .from('node_definitions')
    .select('*')
    .eq('type', id)
    .eq('user_id', user.id)
    .single();
  if (!data) return Response.json({ error: '节点不存在' }, { status: 404 });
  return Response.json({ node: data });
}

// 编辑自定义节点（仅本人）
export async function PATCH(request: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Partial<NodeDefinition> | null;
  const result = await updateCustomNode(user.id, id, body ?? {});
  if (result.error) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ node: result.node });
}

// 删除自定义节点（仅本人）
export async function DELETE(_request: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const { id } = await params;
  // 先取 type（registry 注销用）
  const { data: rec } = await supabase
    .from('node_definitions')
    .select('type')
    .eq('type', id)
    .eq('user_id', user.id)
    .single();
  const result = await deleteCustomNode(user.id, id, rec?.type);
  if (result.error) return Response.json({ error: result.error }, { status: 500 });
  return Response.json({ success: true });
}

// 复制自定义节点
export async function POST(request: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const { id } = await params;
  const { data: rec } = await supabase
    .from('node_definitions')
    .select('*')
    .eq('type', id)
    .eq('user_id', user.id)
    .single();
  if (!rec) return Response.json({ error: '节点不存在' }, { status: 404 });

  const source: NodeDefinition = {
    type: rec.type,
    label: rec.label,
    description: rec.description ?? '',
    category: rec.category ?? 'custom',
    icon: rec.icon ?? undefined,
    inputs: rec.inputs ?? [],
    outputs: rec.outputs ?? [],
    configSchema: rec.config_schema ?? [],
    capabilities: rec.capabilities ?? ['text'],
    executorType: rec.executor_type || rec.type,
    builtin: false,
    source: 'custom',
    version: rec.version ?? 1,
  };
  const result = await duplicateCustomNode(user.id, source);
  if (result.error) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ node: result.node }, { status: 201 });
}
