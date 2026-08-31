import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { supabase } from '@/lib/supabase/server';
import { computeHash } from '@/lib/workflow-hash';
import { evaluateQualityGate, saveGateEvaluation } from '@/lib/quality-gate/evaluator';
import { DEFAULT_POLICY } from '@/lib/quality-gate/policy';
import type { TinyflowData } from '@/lib/tinyflow/types';

export const runtime = 'nodejs';

// POST /api/evolution/quality-gate/check
// body: { workflowId, candidateVersion }
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const workflowId = body?.workflowId as string | undefined;
  const candidateVersion = body?.candidateVersion as number | undefined;

  if (!workflowId) return NextResponse.json({ error: 'workflowId 必填' }, { status: 400 });
  if (candidateVersion === undefined) return NextResponse.json({ error: 'candidateVersion 必填' }, { status: 400 });

  // 校验工作流归属
  const { data: wf } = await supabase
    .from('workflow_history')
    .select('user_id')
    .eq('id', workflowId)
    .maybeSingle();
  if (!wf) return NextResponse.json({ error: '工作流不存在' }, { status: 404 });
  if ((wf as { user_id: string }).user_id !== user.id && user.role !== 'admin') {
    return NextResponse.json({ error: '无权操作' }, { status: 403 });
  }

  // 读取版本数据
  const { data: versionRow } = await supabase
    .from('workflow_versions')
    .select('data')
    .eq('workflow_id', workflowId)
    .eq('version', candidateVersion)
    .maybeSingle();

  if (!versionRow) return NextResponse.json({ error: `版本 v${candidateVersion} 不存在` }, { status: 404 });

  const workflowData = (versionRow as { data: TinyflowData }).data;
  const dataHash = computeHash(workflowData);

  // 服务端加载 policy（不允许客户端覆盖）
  const policy = DEFAULT_POLICY;

  // 执行 Quality Gate（纯确定性）
  const report = await evaluateQualityGate(
    { workflowId, candidateVersion, dataHash },
    workflowData,
    user.id,
    { policy },
  );

  // 持久化 evaluation
  const savedReport = await saveGateEvaluation(report, user.id);

  // 记录审计日志
  try {
    const { logAudit } = await import('@/lib/audit');
    await logAudit({
      userId: user.id,
      username: user.username,
      action: 'quality_gate_check',
      detail: {
        workflowId,
        candidateVersion,
        decision: savedReport.decision,
        gateEvaluationId: savedReport.gateEvaluationId,
      },
      ip: 'quality-gate',
    });
  } catch { /* ignore */ }

  return NextResponse.json(savedReport);
}
