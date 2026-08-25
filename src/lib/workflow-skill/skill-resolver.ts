/**
 * Skill Resolver
 *
 * Skill → Published Workflow Version → FlowEngine
 * 读取 Skill 绑定的工作流版本数据；对外部执行默认使用「发布时快照」。
 */

import { supabase } from '@/lib/supabase/server';
import type { TinyflowData } from '../tinyflow/types';

export interface ResolvedSkillWorkflow {
  workflowId: string;
  workflowVersion: number | null;
  data: TinyflowData;
}

/**
 * 解析 Skill 绑定的工作流数据。
 * @param workflowId 绑定工作流
 * @param workflowVersion 指定版本（可选；发布后的 Skill 用发布快照）
 * @param userId 归属校验
 */
export async function resolveSkillWorkflow(
  workflowId: string,
  workflowVersion: number | null,
  userId: string,
): Promise<{ resolved?: ResolvedSkillWorkflow; error?: string }> {
  const { data: wf } = await supabase
    .from('workflow_history')
    .select('id, user_id, data, published_data, published_version')
    .eq('id', workflowId)
    .maybeSingle();
  if (!wf) return { error: '工作流不存在' };
  if (wf.user_id !== userId) return { error: '无权访问该工作流' };

  // 显式指定版本：取该版本快照
  if (workflowVersion) {
    const { data: ver } = await supabase
      .from('workflow_versions')
      .select('data, version')
      .eq('workflow_id', workflowId)
      .eq('version', workflowVersion)
      .maybeSingle();
    if (!ver) return { error: `工作流 v${workflowVersion} 不存在` };
    return { resolved: { workflowId, workflowVersion: ver.version, data: ver.data as TinyflowData } };
  }

  // 缺省：优先发布快照（Skill 已发布场景），否则当前数据
  const data = (wf.published_data ?? wf.data ?? { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }) as TinyflowData;
  return {
    resolved: {
      workflowId,
      workflowVersion: wf.published_version ?? null,
      data,
    },
  };
}

/** 简易进程内限流（每 Skill 每分钟 N 次；超出返回 rateLimited） */
const buckets = new Map<string, { count: number; windowStart: number }>();

export interface RateLimitCheck {
  limited: boolean;
  remaining: number;
  resetAtMs: number;
}

export function checkRateLimit(
  key: string,
  perMinute: number,
  now = Date.now(),
): RateLimitCheck {
  if (perMinute <= 0) return { limited: false, remaining: Infinity, resetAtMs: 0 };
  const windowMs = 60_000;
  const slot = buckets.get(key);
  const current = slot && now - slot.windowStart < windowMs ? slot : { count: 0, windowStart: now };
  if (current.count >= perMinute) {
    return { limited: true, remaining: 0, resetAtMs: current.windowStart + windowMs };
  }
  current.count += 1;
  buckets.set(key, current);
  return { limited: false, remaining: perMinute - current.count, resetAtMs: current.windowStart + windowMs };
}
