import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { runJsInSandbox } from '@/lib/code-lab/sandbox';

export const runtime = 'nodejs';

// ===== Code Lab 执行端点（与生产 Workflow 执行完全隔离）=====
// POST /api/code-lab/execute  { code, tests, timeoutMs? }
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === 'string' ? body.code : '';
  const tests = typeof body?.tests === 'string' ? body.tests : '';
  if (!code.trim()) {
    return Response.json({ error: '代码不能为空' }, { status: 400 });
  }

  const result = await runJsInSandbox({
    code,
    tests,
    timeoutMs: typeof body?.timeoutMs === 'number' ? body.timeoutMs : undefined,
  });
  return Response.json(result);
}
