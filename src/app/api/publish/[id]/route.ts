import { NextRequest } from 'next/server';
import { getWorkflowByApiKey } from '@/lib/publish-auth';

// 参数文档：外部系统查看该工作流需要传什么输入
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await getWorkflowByApiKey(request.headers.get('authorization'), id);
  if (auth instanceof Response) return auth;

  const { workflow } = auth;

  // 提取开始节点的输入参数定义
  const startNode = workflow.data?.nodes?.find((n) => n.type === 'startNode');
  const parameters = startNode?.data?.parameters ?? [];

  return Response.json({
    id: workflow.id,
    title: workflow.title,
    input_parameters: parameters,
  });
}
