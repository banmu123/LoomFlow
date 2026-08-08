import { NextRequest } from 'next/server';
import { getWorkflowByShareToken } from '@/lib/share-auth';

// 分享页元数据：标题 + 节点摘要 + 开始节点输入参数
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const auth = await getWorkflowByShareToken(token);
  if (auth instanceof Response) return auth;

  const { workflow } = auth;

  // 节点摘要（不含内部字段）
  const nodes = (workflow.data?.nodes || []).map((n) => ({
    id: n.id,
    type: n.type,
    title: (n.data as Record<string, unknown>)?.title || n.type,
    description: (n.data as Record<string, unknown>)?.description || '',
  }));

  const startNode = workflow.data?.nodes?.find((n) => n.type === 'startNode');
  const parameters = (startNode?.data as Record<string, unknown>)?.parameters ?? [];

  return Response.json({
    id: workflow.id,
    title: workflow.title,
    nodes,
    input_parameters: parameters,
  });
}
