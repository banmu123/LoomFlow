import { getCurrentUser } from '@/lib/server-auth';
import { listMilestones, checkAndAwardMilestones } from '@/lib/growth/milestones';

export const runtime = 'nodejs';

// 里程碑列表（GET）——返回已达成 + 全部定义
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const milestones = await listMilestones(user.id);
  return Response.json({ milestones });
}

// 检查并奖励（POST）——从真实行为推导，幂等，返回本次新达成
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: '未登录，请先登录' }, { status: 401 });
  }
  const { awarded } = await checkAndAwardMilestones(user.id);
  const milestones = await listMilestones(user.id);
  return Response.json({ awarded, milestones });
}
