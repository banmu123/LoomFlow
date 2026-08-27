/**
 * Evolution Engine — 权限检查
 *
 * 三级权限模型：
 *   owner  (workflow.user_id === user.id) → 全部操作
 *   member (其他已登录用户)               → 只读
 *   admin  (user.role === 'admin')        → 全部操作
 *
 * 复用现有认证系统（getCurrentUser / server-auth.ts）。
 */

import { getCurrentUser } from '@/lib/server-auth';
import { supabase } from '@/lib/supabase/server';
import type { EvolutionAction, AccessResult } from './types';

export type { EvolutionAction, AccessResult };

/**
 * 检查用户对某工作流 Evolution 数据的访问权限。
 * 返回 AccessResult，allowed=false 时包含错误信息。
 */
export async function checkEvolutionAccess(
  workflowId: string,
  action: EvolutionAction,
): Promise<AccessResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { allowed: false, userId: '', role: 'owner', error: '未登录，请先登录' };
  }

  // admin 全权
  if (user.role === 'admin') {
    return { allowed: true, userId: user.id, role: 'admin' };
  }

  // 查 workflow 归属
  const { data: wf } = await supabase
    .from('workflow_history')
    .select('user_id')
    .eq('id', workflowId)
    .maybeSingle();

  if (!wf) {
    return { allowed: false, userId: user.id, role: 'owner', error: '工作流不存在' };
  }

  // owner 全权
  if (wf.user_id === user.id) {
    return { allowed: true, userId: user.id, role: 'owner' };
  }

  // 非 owner：只读允许，写操作拒绝
  const readOnly = action.endsWith(':read');
  return {
    allowed: readOnly,
    userId: user.id,
    role: 'member',
    error: readOnly ? undefined : '无权操作该工作流',
  };
}

/**
 * API Route 快捷函数：
 * 成功返回 { result }（allowed 一定为 true）；
 * 失败返回 401/403 Response。
 */
export async function requireEvolutionAccess(
  workflowId: string,
  action: EvolutionAction,
): Promise<{ result: AccessResult } | Response> {
  const result = await checkEvolutionAccess(workflowId, action);
  if (!result.allowed) {
    const status = result.error === '未登录，请先登录' ? 401 : 403;
    return Response.json({ error: result.error }, { status });
  }
  return { result };
}
