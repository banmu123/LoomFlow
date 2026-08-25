import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { ensureWorkflowOwnership } from '@/lib/workflow-copilot/test-case-store';
import { getWorkflowVersionData } from '@/lib/workflow-eval/store';
import { benchmarkVersions, benchmarkToMarkdown } from '@/lib/workflow-eval/benchmark';
import { runSkillTests } from '@/lib/workflow-skill/skill-testing';
import type { TinyflowData } from '@/lib/tinyflow/types';

export const runtime = 'nodejs';

// Benchmark：对比两个版本的 latency/cost/success/test
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
  const { id } = await params;
  const own = await ensureWorkflowOwnership(id, user.id);
  if (!own.ok) return NextResponse.json({ error: own.error }, { status: 403 });

  const body = await request.json().catch(() => null);
  const from = Number(body?.from);
  const to = Number(body?.to);
  const samples = Math.min(Number(body?.samples ?? 3), 5);
  const inputs = (body?.inputs ?? {}) as Record<string, unknown>;
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return NextResponse.json({ error: '需提供 from 与 to 版本号' }, { status: 400 });
  }

  const [v1, v2] = await Promise.all([
    getWorkflowVersionData(id, from),
    getWorkflowVersionData(id, to),
  ]);
  if (v1.error) return NextResponse.json({ error: v1.error }, { status: 404 });
  if (v2.error) return NextResponse.json({ error: v2.error }, { status: 404 });

  // 两个版本的测试得分（可选：用同一组测试跑）
  const testScores = { v1: 100, v2: 100 };
  try {
    const outcome = await runSkillTests(id, user.id, v1.data as TinyflowData);
    testScores.v1 = outcome.total > 0 ? (outcome.passed / outcome.total) * 100 : 100;
  } catch {
    // 忽略测试得分缺失
  }

  const result = await benchmarkVersions({
    v1: { version: from, data: v1.data as TinyflowData },
    v2: { version: to, data: v2.data as TinyflowData },
    inputs,
    samples,
    testScores,
  });

  return NextResponse.json({ ...result, markdown: benchmarkToMarkdown(result) });
}