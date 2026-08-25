import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/server-auth';
import { getSkill, updateSkill } from '@/lib/workflow-skill/skill-store';
import { getWorkflowDataAtVersion } from '@/lib/workflow-skill/skill-testing';
import { runSkillTests, canPublish } from '@/lib/workflow-skill/skill-testing';

export const runtime = 'nodejs';

/**
 * Skill 发布（Part 十一 Publish Targets：Web UI / API / Share）
 *
 * body:
 *   targets?: { webUi?, api?, share? }  发布目标（缺省全 false）
 *   force?: boolean                      是否跳过测试门禁强制发布（默认 false）
 *
 * 原则 5：发布前必须通过 Validation + Test（关键测试失败默认禁止发布，除非显式 force）。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null);

  const { skill, error } = await getSkill(id, user.id);
  if (error) return NextResponse.json({ error }, { status: 404 });

  // 测试门禁：读取绑定工作流并跑测试
  const { data, error: verErr } = await getWorkflowDataAtVersion(
    skill!.workflowId,
    user.id,
    skill!.workflowVersion,
  );
  if (verErr || !data) return NextResponse.json({ error: verErr ?? '无法读取工作流' }, { status: 400 });

  const outcome = await runSkillTests(skill!.workflowId, user.id, data as never);
  const gate = canPublish(outcome);
  if (!gate.ok && !body?.force) {
    return NextResponse.json(
      { error: `发布被测试门禁拦截: ${gate.reason}` },
      { status: 409 },
    );
  }

  // 生成共享 token（share 目标）
  const targets = body?.targets ?? { webUi: true, api: false, share: false };
  const prevTargets = skill!.publishedTargets;
  const shareToken = targets.share && !prevTargets.shareToken ? crypto.randomUUID() : prevTargets.shareToken ?? null;

  const publishedTargets = {
    webUi: targets.webUi !== undefined ? targets.webUi : prevTargets.webUi,
    api: targets.api !== undefined ? targets.api : prevTargets.api,
    share: targets.share !== undefined ? targets.share : prevTargets.share,
    shareToken,
  };

  const result = await updateSkill(id, user.id, {
    publishedTargets,
    status: 'published',
  });
  if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });

  return NextResponse.json({
    skillId: id,
    status: 'published',
    publishedTargets,
    tests: outcome,
    note: gate.ok ? '测试通过，已发布' : '已强制发布（部分测试未通过）',
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录，请先登录' }, { status: 401 });
  const { id } = await params;
  const { skill, error } = await getSkill(id, user.id);
  if (error) return NextResponse.json({ error }, { status: 404 });

  const result = await updateSkill(id, user.id, {
    status: 'draft',
    publishedTargets: { webUi: true, api: false, share: false, shareToken: skill!.publishedTargets.shareToken },
  });
  if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ skillId: id, status: 'draft', unpublished: true });
}
